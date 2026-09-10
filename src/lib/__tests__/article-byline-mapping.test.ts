import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `toArticle` is module-private, so these assert on the mapper's source. The
// property under test is structural: MongoDB stores the byline as a Schema.org
// sub-document (`author: { '@type': 'Person', name }`) — sources.ts and
// analytics.ts both already read it that way — but MongoArticle never declared
// it and toArticle never mapped it. The result was that `Article.author` was
// undefined for every article, so the NewsArticle JSON-LD, the page metadata
// and the markdown served to answer engines all silently fell back to
// attributing each piece to the outlet rather than the journalist. The
// pipeline's byline backfill was landing in a field nothing read.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

describe('article mapper carries the byline', () => {
  const src = read('src/lib/mongodb/articles.ts');

  it('declares author as the Schema.org sub-document, not a string', () => {
    expect(src).toMatch(/author\?:\s*\{\s*'@type'\?:\s*string;\s*name\?:\s*string\s*\}/);
  });

  it('maps author.name onto Article.author', () => {
    expect(src).toMatch(/author:\s*typeof doc\.author\?\.name === 'string'/);
  });

  it('maps the document language rather than asserting English', () => {
    expect(src).toMatch(/language:\s*typeof doc\.inLanguage === 'string'/);
  });

  it('does not read author out of a list projection that excludes it', () => {
    // LIST_PROJECTION is exclusion-based, so author is returned by default.
    // If it ever becomes inclusion-based, author must be named explicitly.
    const proj = src.match(/const LIST_PROJECTION = \{([\s\S]*?)\} as const/);
    expect(proj).not.toBeNull();
    const body = proj![1];
    const isExclusionOnly = /:\s*0\b/.test(body) && !/:\s*1\b/.test(body);
    expect(isExclusionOnly || /author/.test(body)).toBe(true);
  });
});

describe('downstream consumers use the byline and language', () => {
  it('NewsArticle JSON-LD takes inLanguage from the article', () => {
    expect(read('src/components/ui/json-ld.tsx')).toMatch(
      /inLanguage:\s*article\.language \|\| "en"/
    );
  });

  it('the Article type exposes language', () => {
    expect(read('src/lib/api.ts')).toMatch(/language\?:\s*string;/);
  });

  it('the agent markdown distinguishes the journalist from the publisher', () => {
    const md = read('src/app/api/agent-md/route.ts');
    expect(md).toMatch(/\*\*Published by:\*\*/);
    expect(md).toMatch(/\*\*By:\*\*/);
  });
});
