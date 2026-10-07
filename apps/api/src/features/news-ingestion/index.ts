export {
  collectCandidates,
  createNewsIngestion,
  createNewsIngestionFromConfig,
  formatSummary,
  type IngestionSummary,
  type NewsIngestion,
} from './news-ingestion.service';
export { listProcessedArticles, type ProcessedArticleRow } from './news-ingestion.repository';
export { NEWS_SOURCES } from './news-sources';
export { fetchFeedText } from './rss';
