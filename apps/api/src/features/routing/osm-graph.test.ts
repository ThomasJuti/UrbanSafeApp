import { PARAMS } from '@urbansafe/shared';
import { describe, expect, it } from 'vitest';
import { buildRoadEdges, directionOf, haversineM, isRideable, type OsmNode, type OsmWay } from './osm-graph';

function nodeMap(list: [number, number, number][]): Map<number, OsmNode> {
  return new Map(list.map(([id, lon, lat]) => [id, { id, lon, lat }]));
}

// Una cruz: la vía 1 va de 1 a 3 pasando por 2; la vía 2 cruza en 2 hacia 4.
const nodes = nodeMap([
  [1, 0, 0],
  [2, 0.001, 0],
  [3, 0.002, 0],
  [4, 0.001, 0.001],
]);

describe('isRideable (M5)', () => {
  it('acepta calles para moto y rechaza peatonales, ciclorrutas y escaleras', () => {
    expect(isRideable({ highway: 'residential' })).toBe(true);
    expect(isRideable({ highway: 'primary_link' })).toBe(true);
    for (const highway of ['footway', 'pedestrian', 'cycleway', 'steps', 'path']) {
      expect(isRideable({ highway })).toBe(false);
    }
  });

  it('rechaza los carriles exclusivos y las vías privadas', () => {
    expect(isRideable({ highway: 'service', access: 'no', bus: 'designated' })).toBe(false);
    expect(isRideable({ highway: 'residential', motor_vehicle: 'private' })).toBe(false);
    expect(isRideable({ highway: 'primary', motorcycle: 'no' })).toBe(false);
  });

  it('una habilitación explícita para moto gana sobre access=no', () => {
    expect(isRideable({ highway: 'service', access: 'no', motorcycle: 'yes' })).toBe(true);
  });
});

describe('directionOf', () => {
  it('lee oneway y las rotondas', () => {
    expect(directionOf({ highway: 'residential' })).toBe('both');
    expect(directionOf({ highway: 'residential', oneway: 'yes' })).toBe('forward');
    expect(directionOf({ highway: 'residential', oneway: '-1' })).toBe('backward');
    expect(directionOf({ highway: 'primary', junction: 'roundabout' })).toBe('forward');
    expect(directionOf({ highway: 'motorway' })).toBe('forward');
    expect(directionOf({ highway: 'motorway', oneway: 'no' })).toBe('both');
  });
});

describe('buildRoadEdges', () => {
  it('parte una vía en cada cruce con otra', () => {
    const ways: OsmWay[] = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { id: 20, nodes: [2, 4], tags: { highway: 'residential' } },
    ];

    const edges = buildRoadEdges(ways, nodes);

    expect(edges.map((e) => [e.osmWayId, e.source, e.target])).toEqual([
      [10, 1, 2],
      [10, 2, 3],
      [20, 2, 4],
    ]);
  });

  it('el costo es el tiempo a la velocidad promedio y el sentido prohibido queda negativo', () => {
    const [edge] = buildRoadEdges([{ id: 10, nodes: [1, 2], tags: { highway: 'primary', oneway: 'yes' } }], nodes);
    const expectedSeconds = haversineM([0, 0], [0.001, 0]) / ((PARAMS.motorcycleSpeedKmh * 1000) / 3600);

    expect(edge?.lengthM).toBeCloseTo(111.2, 0);
    expect(edge?.costS).toBeCloseTo(expectedSeconds);
    expect(edge?.reverseCostS).toBeLessThan(0);
  });

  it('ignora las vías no aptas aunque compartan nodos', () => {
    const ways: OsmWay[] = [
      { id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
      { id: 30, nodes: [2, 4], tags: { highway: 'footway' } },
    ];

    expect(buildRoadEdges(ways, nodes).map((e) => [e.source, e.target])).toEqual([[1, 3]]);
  });

  it('corta donde falta un nodo fuera de la zona descargada', () => {
    const ways: OsmWay[] = [{ id: 10, nodes: [1, 2, 99, 3, 4], tags: { highway: 'residential' } }];

    expect(buildRoadEdges(ways, nodes).map((e) => [e.source, e.target])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
