/**
 * Platform Services Index
 *
 * All platform-level services that enable Mukoko to leapfrog
 * every competitor in the news API space.
 */

export { ContentModerationService } from './ContentModerationService.js';
export type { ModerationResult, ModerationFlag, ModerationFlagType, CulturalAlignmentScore, FactCheckSignal, ModerationConfig } from './ContentModerationService.js';

export { DynamicDataService } from './DynamicDataService.js';
export type { DynamicCategory, DynamicKeyword, DynamicSource, DynamicTag, DynamicCountry } from './DynamicDataService.js';

export { FeedOutputService } from './FeedOutputService.js';
export type { FeedArticle, FeedOptions } from './FeedOutputService.js';

export { APIKeyService, TIER_CONFIGS } from './APIKeyService.js';
export type { APIKey, APIKeyTier, APIKeyPermission, RateLimitConfig } from './APIKeyService.js';

export { PublisherService, PublisherError } from './PublisherService.js';
export type { Publisher, VerificationLevel, PublisherArticleSubmission, PublisherAnalytics } from './PublisherService.js';

export { WebhookService, WebhookError } from './WebhookService.js';
export type { WebhookSubscription, WebhookEvent, WebhookFilters, WebhookDelivery, WebhookPayload } from './WebhookService.js';

export { SSEStreamService } from './SSEStreamService.js';
export type { SSEEvent, SSEEventType, SSEStreamOptions } from './SSEStreamService.js';

export { SmartHomeBriefingService } from './SmartHomeBriefingService.js';
export type { BriefingOptions, AlexaFlashBriefingItem, GoogleAssistantResponse, GenericBriefing } from './SmartHomeBriefingService.js';

export { OpenDataService, MANIFESTO } from './OpenDataService.js';
export type { OpenDataManifesto, OpenDataCategory, OpenDataExport } from './OpenDataService.js';
