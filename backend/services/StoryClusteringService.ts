/**
 * StoryClusteringService
 *
 * Groups similar news articles from different sources together
 * using Jaccard similarity on normalized title words.
 */

// Common stop words to filter out from title comparison
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also', 'now',
  'says', 'said', 'will', 'would', 'could', 'should', 'have', 'has',
  'had', 'been', 'being', 'this', 'that', 'these', 'those', 'what',
  'which', 'while', 'news', 'report', 'reports', 'breaking', 'update',
  'latest', 'today', 'yesterday', 'new', 'first', 'last', 'over',
]);

// Limits for DoS prevention
const MAX_TITLE_LENGTH = 500;
const MAX_WORDS = 50;

export interface Article {
  id: string;
  headline: string;
  publisher_name: string;
  [key: string]: unknown;
}

export interface StoryCluster {
  id: string;
  primaryArticle: Article;
  relatedArticles: Article[];
  articleCount: number;
}

export interface ClusteringConfig {
  similarityThreshold: number;
  maxRelatedPerCluster: number;
  maxClusters: number;
}

const DEFAULT_CONFIG: ClusteringConfig = {
  similarityThreshold: 0.35,
  maxRelatedPerCluster: 4,
  maxClusters: 10,
};

/**
 * Normalizes a title for comparison by:
 * 1. Converting to lowercase
 * 2. Removing punctuation
 * 3. Splitting into words
 * 4. Filtering out short words (<4 chars) and stop words
 *
 * Includes DoS prevention with length limits.
 */
export function normalizeHeadline(title: string): string[] {
  if (!title || typeof title !== 'string') {
    return [];
  }

  // DoS prevention: limit title length
  const limitedTitle = title.substring(0, MAX_TITLE_LENGTH);

  return limitedTitle
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3 && !STOP_WORDS.has(word))
    .slice(0, MAX_WORDS); // DoS prevention: limit word count
}

/**
 * Calculates Jaccard similarity between two word arrays.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function titleSimilarity(words1: string[], words2: string[]): number {
  if (words1.length === 0 || words2.length === 0) {
    return 0;
  }

  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Clusters articles by title similarity.
 * Groups articles from different sources covering the same story.
 */
export function clusterArticles(
  articles: Article[],
  config: Partial<ClusteringConfig> = {}
): StoryCluster[] {
  const {
    similarityThreshold,
    maxRelatedPerCluster,
    maxClusters,
  } = { ...DEFAULT_CONFIG, ...config };

  if (!articles || articles.length === 0) {
    return [];
  }

  const clusters: StoryCluster[] = [];
  const clusteredIds = new Set<string>();

  for (const article of articles) {
    if (clusteredIds.has(article.id)) continue;

    const articleWords = normalizeHeadline(article.headline);
    const cluster: StoryCluster = {
      id: `cluster-${article.id}`,
      primaryArticle: article,
      relatedArticles: [],
      articleCount: 1,
    };

    clusteredIds.add(article.id);

    // Find related articles (same story from different sources)
    for (const other of articles) {
      if (clusteredIds.has(other.id)) continue;
      if (article.publisher_name === other.publisher_name) continue; // Must be different sources

      const otherWords = normalizeHeadline(other.headline);
      const similarity = titleSimilarity(articleWords, otherWords);

      // Group stories that exceed similarity threshold
      if (similarity > similarityThreshold) {
        cluster.relatedArticles.push(other);
        cluster.articleCount++;
        clusteredIds.add(other.id);

        if (cluster.relatedArticles.length >= maxRelatedPerCluster) break;
      }
    }

    clusters.push(cluster);
    if (clusters.length >= maxClusters) break;
  }

  return clusters;
}
