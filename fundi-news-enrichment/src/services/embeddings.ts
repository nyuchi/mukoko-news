import type { Env } from '../types';

export async function generateEmbedding(text: string, env: Env): Promise<number[] | null> {
  try {
    const response = await env.AI.run('@cf/baai/bge-m3', {
      text: [text.slice(0, 512)],
    }) as { data: number[][] };
    return response.data?.[0] ?? null;
  } catch (err) {
    console.error('[EMBEDDINGS] Failed to generate embedding:', err);
    return null;
  }
}
