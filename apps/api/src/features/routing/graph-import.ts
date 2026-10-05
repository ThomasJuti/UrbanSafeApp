import { PARAMS } from '@urbansafe/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../shared/db';
import { buildRoadEdges, RIDEABLE_HIGHWAYS, type OsmNode, type OsmWay, type RoadEdge } from './osm-graph';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_TIMEOUT_S = 300;
// Overpass rechaza peticiones sin un User-Agent que identifique a la aplicación.
const USER_AGENT = 'UrbanSafe/0.1 (github.com/ThomasJuti/UrbanSafeApp)';
const VERTEX_BATCH = 5000;
const EDGE_BATCH = 2000;

const overpassSchema = z.object({
  elements: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('node'), id: z.number(), lat: z.number(), lon: z.number() }),
      z.object({
        type: z.literal('way'),
        id: z.number(),
        nodes: z.array(z.number()),
        tags: z.record(z.string(), z.string()).default({}),
      }),
    ]),
  ),
});

async function downloadOsm(log: (message: string) => void) {
  const { minLat, minLng, maxLat, maxLng } = PARAMS.urbanBbox;
  const query = `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
way["highway"~"^(${RIDEABLE_HIGHWAYS.join('|')})$"](${minLat},${minLng},${maxLat},${maxLng});
(._;>;);
out body qt;`;

  log('Descargando vías de Overpass…');
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout((OVERPASS_TIMEOUT_S + 60) * 1000),
  });
  if (!response.ok) throw new Error(`Overpass respondió ${response.status}: ${await response.text()}`);

  const { elements } = overpassSchema.parse(await response.json());
  const ways: OsmWay[] = [];
  const nodes = new Map<number, OsmNode>();
  for (const element of elements) {
    if (element.type === 'way') ways.push(element);
    else nodes.set(element.id, element);
  }
  log(`${ways.length} vías y ${nodes.size} nodos descargados`);
  return { ways, nodes };
}

function lineWkt(coords: [number, number][]): string {
  return `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(',')})`;
}

async function writeGraph(db: Db, edges: RoadEdge[], nodes: Map<number, OsmNode>, log: (message: string) => void) {
  const vertexIds = [...new Set(edges.flatMap((edge) => [edge.source, edge.target]))];

  // En una transacción para que, si algo falla a mitad, quede el grafo anterior completo. El
  // truncate bloquea las tablas: mientras tanto el ruteo espera, así que no correrlo en la demo.
  await db.transaction().execute(async (trx) => {
    await sql`truncate road_edges, road_vertices`.execute(trx);

    for (let i = 0; i < vertexIds.length; i += VERTEX_BATCH) {
      const rows = vertexIds.slice(i, i + VERTEX_BATCH).map((id) => {
        const node = nodes.get(id)!;
        return { id: String(id), geom: sql`ST_SetSRID(ST_MakePoint(${node.lon}, ${node.lat}), 4326)` };
      });
      await trx.insertInto('road_vertices').values(rows).execute();
    }
    log(`${vertexIds.length} vértices escritos`);

    for (let i = 0; i < edges.length; i += EDGE_BATCH) {
      const rows = edges.slice(i, i + EDGE_BATCH).map((edge) => ({
        osm_way_id: String(edge.osmWayId),
        source: String(edge.source),
        target: String(edge.target),
        highway: edge.highway,
        name: edge.name,
        length_m: edge.lengthM,
        cost_s: edge.costS,
        reverse_cost_s: edge.reverseCostS,
        geom: sql`ST_GeomFromText(${lineWkt(edge.coords)}, 4326)`,
      }));
      await trx.insertInto('road_edges').values(rows).execute();
    }
    log(`${edges.length} tramos escritos`);

    // M5: si se enruta hacia una isla (por ejemplo un conjunto cerrado mal etiquetado o una
    // salida en contravía) no hay ruta posible. Me quedo con el componente fuerte más grande.
    const removed = await sql<{ edges: string; vertices: string }>`
      with components as (
        select component, node
        from pgr_strongComponents('select id, source, target, cost_s as cost, reverse_cost_s as reverse_cost from road_edges')
      ),
      largest as (
        select component from components group by component order by count(*) desc limit 1
      ),
      keep as (
        select node from components where component = (select component from largest)
      ),
      deleted_edges as (
        delete from road_edges e
        where e.source not in (select node from keep) or e.target not in (select node from keep)
        returning 1
      ),
      deleted_vertices as (
        delete from road_vertices v where v.id not in (select node from keep) returning 1
      )
      select (select count(*) from deleted_edges) as edges, (select count(*) from deleted_vertices) as vertices
    `.execute(trx);
    const row = removed.rows[0];
    log(`Fuera del componente principal: ${row?.edges ?? 0} tramos y ${row?.vertices ?? 0} vértices eliminados`);
  });

  await sql`analyze road_edges, road_vertices`.execute(db);
}

export async function importRoadGraph(db: Db, log: (message: string) => void = console.log) {
  const { ways, nodes } = await downloadOsm(log);
  const edges = buildRoadEdges(ways, nodes);
  log(`${edges.length} tramos construidos`);
  await writeGraph(db, edges, nodes, log);
}
