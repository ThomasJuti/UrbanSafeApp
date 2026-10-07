// M1 a mano. Tres modos:
//   pnpm ingest:news             una corrida completa (necesita las claves del LLM y del geocodificador)
//   pnpm ingest:news --dry-run   solo descarga y lee los feeds; no llama al LLM ni escribe en la base
//   pnpm ingest:sample [n]       exporta en Markdown los últimos n artículos procesados (50) para la
//                                revisión manual de §7; con --out <archivo> lo escribe ahí
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  collectCandidates,
  createNewsIngestionFromConfig,
  fetchFeedText,
  formatSummary,
  listProcessedArticles,
  NEWS_SOURCES,
  type ProcessedArticleRow,
} from '../features/news-ingestion';
import { createRiskService } from '../features/risk';
import { loadConfig, type Config } from '../shared/config';
import { createDb, type Db } from '../shared/db';
import { createEventBus } from '../shared/events';

const STATEMENT_TIMEOUT_MS = 30 * 1000;
// Una conexión la ocupa el lock de la corrida; el resto alcanza para los artículos en paralelo.
const POOL_SIZE = 6;
const DEFAULT_SAMPLE_SIZE = 50;

const { values, positionals } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
  allowPositionals: true,
});

async function dryRun() {
  const collected = await collectCandidates(NEWS_SOURCES, fetchFeedText, new Date());
  for (const feed of collected.feeds) {
    console.log(`${feed.id}: ${feed.error ? `ERROR ${feed.error}` : `${feed.items} ítems${feed.invalid ? `, ${feed.invalid} inválidos` : ''}`}`);
  }
  const fromGoogle = collected.candidates.filter((c) => c.googleLink);
  const decoded = fromGoogle.filter((c) => c.url);
  console.log(
    [
      `${collected.candidates.length} candidatos únicos`,
      `${collected.stale} viejos`,
      `${collected.prefiltered} sin términos de delito`,
      `${collected.invalid} inválidos`,
      `enlaces de Google decodificados: ${decoded.length}/${fromGoogle.length}`,
    ].join(' · '),
  );
}

async function ingest(db: Db, config: Config) {
  const news = createNewsIngestionFromConfig({ db, bus: createEventBus(), config: config.newsIngestion });
  if (!news) {
    process.exitCode = 1;
    return;
  }
  const summary = await news.runOnce();
  if (!summary) {
    console.log('Ya hay una ingesta corriendo (servidor u otra terminal); no se hizo nada.');
    return;
  }
  for (const feed of summary.feeds.filter((f) => f.error)) console.warn(`${feed.id}: ${feed.error}`);
  console.log(formatSummary(summary));
  // Aquí no hay un `risk` escuchando el bus: si cambió algún incidente se recalcula todo una vez.
  if (summary.created + summary.merged > 0) await createRiskService(db).refreshAll();
}

const cell = (value: string | null) => (value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ');

function toMarkdown(rows: ProcessedArticleRow[]): string {
  const header =
    '| # | Procesado | Medio | Título | Tipo extraído | Ubicación extraída | Geocodificado | Resultado | ¿Tipo y ubicación correctos? |\n' +
    '|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((row, index) => {
    const result =
      row.status === 'incident' ? `${row.outcome} (${row.incidentId?.slice(0, 8)})` : `${row.status}: ${row.discardReason ?? ''}`;
    return `| ${index + 1} | ${row.processedAt.toISOString()} | ${cell(row.mediaName)} | [${cell(row.title)}](${row.link}) | ${cell(row.extractedType)} | ${cell(row.locationText)} | ${cell(row.geocodeKind)} | ${cell(result)} |  |`;
  });
  return `# Muestra de extracción de noticias (M1, §7)\n\nGenerada el ${new Date().toISOString()} con los últimos ${rows.length} artículos procesados.\n\n${header}\n${lines.join('\n')}\n`;
}

async function sample(db: Db) {
  const size = Number(positionals[0] ?? DEFAULT_SAMPLE_SIZE);
  const rows = await listProcessedArticles(db, Number.isInteger(size) && size > 0 ? size : DEFAULT_SAMPLE_SIZE);
  const markdown = toMarkdown(rows);
  if (values.out) {
    await writeFile(values.out, markdown);
    console.log(`Muestra de ${rows.length} artículos escrita en ${values.out}`);
  } else {
    process.stdout.write(markdown);
  }
}

if (values['dry-run']) {
  await dryRun();
} else {
  const config = loadConfig();
  const { db } = createDb({ url: config.databaseUrl, poolSize: POOL_SIZE, statementTimeoutMs: STATEMENT_TIMEOUT_MS });
  try {
    await (values.sample ? sample(db) : ingest(db, config));
  } finally {
    await db.destroy();
  }
}
