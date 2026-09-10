import { describe, it, expect } from 'vitest';
import { authorHref, authorKey, authorSlug, isDeskByline } from '../author-identity';

/**
 * The person/desk distinction, which is the only thing standing between an
 * author page and a false claim about who wrote 198 articles.
 *
 * These assertions are written against the bylines that are actually in the
 * corpus, not invented ones — the measured shape of the data is the reason each
 * rule exists, so a test that used a tidy fixture would pass while the rule it
 * checks did nothing for the real cases.
 */

describe('isDeskByline', () => {
  it('calls the measured desk bylines desks', () => {
    // "Staff Reporter" is 198 articles across TEN newsrooms in FOUR countries.
    // "Online Reporter" is 1,111 across two. Both are labels a masthead puts on
    // its own staff, not names of people.
    for (const desk of [
      'Staff Reporter',
      'Online Reporter',
      'Herald Reporter',
      'Correspondent',
      'Staff Writer',
      'Business Editor',
      'Newsroom',
      'Sports Desk',
      'IOL Staff',
      'Africa Bureau',
    ]) {
      expect(isDeskByline(desk)).toBe(true);
    }
  });

  it('calls a named journalist a person', () => {
    for (const person of [
      'Abubakar Ibrahim',
      'Nwafor',
      'José Silva',
      'Jean-Pierre Bemba',
      'Mary Moyo',
    ]) {
      expect(isDeskByline(person)).toBe(false);
    }
  });

  it('does not fire on a desk word buried inside a name', () => {
    // The reason the pattern is not built on `\b`: a substring test would make
    // "Newsome" a newsroom and "Staffordshire" a staff desk, and the reader
    // would be shown a person's work filed under a masthead's desk.
    for (const person of ['David Newsome', 'Ann Staffordshire', 'Desklin Moyo']) {
      expect(isDeskByline(person)).toBe(false);
    }
  });

  it('is not fooled by ASCII-only word boundaries', () => {
    // `\b` is defined on `\w`, which excludes accented letters — so `\bstaff\b`
    // matches inside a word whose neighbouring character is accented. This
    // corpus carries French, Portuguese and Arabic feeds and cannot assume ASCII.
    expect(isDeskByline('Zébéstaff')).toBe(false);
    expect(isDeskByline('Béatrice Editorial')).toBe(true);
  });

  it('leaves outlet-shaped bylines alone', () => {
    // "Malawi Voice" (258 articles) is an outlet filing under its own name.
    // That is a different problem from a desk byline and scoping it to itself
    // would fix nothing, so the lexicon deliberately carries no masthead words.
    for (const outlet of ['Malawi Voice', 'zamobserver', 'Daily Post', 'The Times']) {
      expect(isDeskByline(outlet)).toBe(false);
    }
  });
});

describe('authorSlug', () => {
  it('folds case, spacing and punctuation', () => {
    expect(authorSlug('  Abubakar   Ibrahim ')).toBe('abubakar-ibrahim');
    expect(authorSlug("Jean-Pierre O'Brien")).toBe('jean-pierre-o-brien');
  });

  it('folds diacritics so one journalist has one page', () => {
    // The corpus spells the same byline both ways. Two pages for one person
    // splits their work in half and neither page says so.
    expect(authorSlug('José Silva')).toBe(authorSlug('Jose Silva'));
    expect(authorSlug('Béatrice Mukendi')).toBe('beatrice-mukendi');
  });

  it('keeps letters outside the Latin script rather than erasing the byline', () => {
    expect(authorSlug('محمد صلاح')).toBe('محمد-صلاح');
  });

  it('returns empty for a byline with no letters at all', () => {
    // Not linkable. Callers must treat this as "no page", never as `/author/`.
    expect(authorSlug('---')).toBe('');
    expect(authorSlug('')).toBe('');
  });

  it('is the same function as the identity key', () => {
    // If the key and the slug could disagree, two spellings would merge in the
    // directory and split in the URL — or the reverse — and nothing would
    // report it. They are one function on purpose.
    expect(authorKey).toBe(authorSlug);
  });
});

describe('authorHref', () => {
  it('gives a person one page across the whole corpus', () => {
    // The point of the page, and what answers "which sources does she write for".
    expect(authorHref('Abubakar Ibrahim', 'Joy News')).toBe('/author/abubakar-ibrahim');
  });

  it('scopes a desk byline to its newsroom', () => {
    expect(authorHref('Herald Reporter', 'The Herald')).toBe(
      '/author/the-herald/herald-reporter'
    );
  });

  it('refuses to link a desk byline with no newsroom', () => {
    // The whole failure this module exists to prevent: an unscoped "Staff
    // Reporter" page would present ten mastheads' staff, in four countries, as
    // one journalist. Plain text is a smaller loss than a false attribution.
    expect(authorHref('Staff Reporter', undefined)).toBeNull();
    expect(authorHref('Staff Reporter', '   ')).toBeNull();
  });

  it('refuses to link a byline it cannot address', () => {
    expect(authorHref(undefined, 'The Herald')).toBeNull();
    expect(authorHref('...', 'The Herald')).toBeNull();
  });

  it('does not let a person be scoped by a newsroom', () => {
    // A person has one address whatever masthead they filed to, so the newsroom
    // argument must not leak into their URL — two URLs for one page split its
    // ranking and the reader sees a different article count on each.
    expect(authorHref('Mary Moyo', 'The Herald')).toBe(authorHref('Mary Moyo', 'Daily Nation'));
  });
});
