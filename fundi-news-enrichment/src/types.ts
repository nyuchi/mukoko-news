export interface Env {
  AI: Ai;
  MONGODB_URI: string;
  ENRICHMENT_API_TOKEN: string;
  FUNDI_INGESTION_URL: string;      // https://fundi-ingestion.nyuchi.dev
  FUNDI_INGESTION_TOKEN: string;
  AI_GATEWAY_ID: string;
  NODE_ENV: string;
}

export interface Article {
  _id: string;
  headline: string;
  description?: string;
  articleBody?: string;
  articleBodyProcessed?: string;
  inLanguage: string;
  countryCode?: string;
  mediaOrganizationId?: string;
  feedSourceId?: string;
  categoryIds?: string[];
  tagIds?: string[];
  wordCount?: number;
  aiProcessed?: boolean;
  moderationStatus?: string;
}

export interface EnrichmentResult {
  articleId: string;
  categories: string[];
  keywords: string[];
  namedEntities: NamedEntity[];
  qualityScore: number;
  qualitySignals: Record<string, number>;
  embedding?: number[];
  sentiment?: string;
  language?: string;
  summary?: string;
}

export interface NamedEntity {
  name: string;
  type: 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'EVENT' | 'OTHER';
  confidence: number;
}

export interface EnrichRequest {
  articleIds: string[];
  source?: string;      // 'rss' | 'newsdata_api' | 'manual'
  priority?: 'high' | 'normal' | 'low';
}

export interface OrgEnrichRequest {
  entityId: string;
  mediaOrgId: string;
  name: string;
  url?: string;
  countryCode: string;
  schemaOrgType: string;
}
