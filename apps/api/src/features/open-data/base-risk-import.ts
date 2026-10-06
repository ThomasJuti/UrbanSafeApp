import type { Db } from '../../shared/db';
import { replaceBaseRisk } from './base-risk.repository';
import { daiFeatureCollectionSchema, toSnapshot } from './dai-source';

// Servicio oficial de la Secretaría de Seguridad detrás del dataset "Delito de Alto Impacto"
// (localidades). Se usa en vez del zip del portal porque su URL no cambia con cada publicación.
const DAI_LAYER_URL = 'https://oaiee.scj.gov.co/agc/rest/services/Tematicos_Pub/CifrasSCJ/MapServer/0/query';
const USER_AGENT = 'UrbanSafe/0.1 (github.com/ThomasJuti/UrbanSafeApp)';
const DOWNLOAD_TIMEOUT_MS = 60_000;

async function downloadDai() {
  const params = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson' });
  const response = await fetch(`${DAI_LAYER_URL}?${params}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/geo+json, application/json' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`El servicio de datos abiertos respondió ${response.status}`);
  return daiFeatureCollectionSchema.parse(await response.json());
}

export async function importBaseRisk(db: Db, log: (message: string) => void = console.log) {
  log('Descargando Delito de Alto Impacto por localidad…');
  const snapshot = toSnapshot(await downloadDai());
  log(`${snapshot.zones.length} localidades, periodo ${snapshot.period}`);
  await db.transaction().execute((trx) => replaceBaseRisk(trx, snapshot));
}
