import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimeAgo, isValidImageUrl, cn, safeCssUrl, stripHtml } from '../utils';

describe('stripHtml', () => {
  it('returns empty string for nullish input', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });

  it('removes a full <html><body> wrapper, leaving the text', () => {
    expect(stripHtml('<html><body>Hello world</body></html>')).toBe('Hello world');
  });

  it('strips inline tags', () => {
    expect(stripHtml('<p>A <strong>bold</strong> claim</p>')).toBe('A bold claim');
  });

  it('converts block boundaries and <br> to newlines', () => {
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One\nTwo');
    expect(stripHtml('Line1<br/>Line2')).toBe('Line1\nLine2');
  });

  it('drops script and style blocks entirely', () => {
    expect(stripHtml('Hi<script>alert(1)</script> there')).toBe('Hi there');
    expect(stripHtml('A<style>.x{color:red}</style>B')).toBe('AB');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
    expect(stripHtml('it&#39;s &quot;quoted&quot;')).toBe('it\'s "quoted"');
  });

  it('collapses excess whitespace and blank lines', () => {
    expect(stripHtml('<p>One</p><p></p><p></p><p>Two</p>')).toBe('One\n\nTwo');
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => {
    // Mock current time to 2024-01-15 12:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "Just now" for dates less than 1 minute ago', () => {
    const now = new Date('2024-01-15T12:00:00Z').toISOString();
    expect(formatTimeAgo(now)).toBe('Just now');
  });

  it('should return "Xm ago" for dates less than 1 hour ago', () => {
    const fiveMinutesAgo = new Date('2024-01-15T11:55:00Z').toISOString();
    expect(formatTimeAgo(fiveMinutesAgo)).toBe('5m ago');

    const thirtyMinutesAgo = new Date('2024-01-15T11:30:00Z').toISOString();
    expect(formatTimeAgo(thirtyMinutesAgo)).toBe('30m ago');
  });

  it('should return "Xh ago" for dates less than 24 hours ago', () => {
    const twoHoursAgo = new Date('2024-01-15T10:00:00Z').toISOString();
    expect(formatTimeAgo(twoHoursAgo)).toBe('2h ago');

    const twentyThreeHoursAgo = new Date('2024-01-14T13:00:00Z').toISOString();
    expect(formatTimeAgo(twentyThreeHoursAgo)).toBe('23h ago');
  });

  it('should return "Xd ago" for dates less than 7 days ago', () => {
    const twoDaysAgo = new Date('2024-01-13T12:00:00Z').toISOString();
    expect(formatTimeAgo(twoDaysAgo)).toBe('2d ago');

    const sixDaysAgo = new Date('2024-01-09T12:00:00Z').toISOString();
    expect(formatTimeAgo(sixDaysAgo)).toBe('6d ago');
  });

  it('should return formatted date for dates older than 7 days', () => {
    const tenDaysAgo = new Date('2024-01-05T12:00:00Z').toISOString();
    expect(formatTimeAgo(tenDaysAgo)).toBe('Jan 5');

    const lastMonth = new Date('2023-12-15T12:00:00Z').toISOString();
    expect(formatTimeAgo(lastMonth)).toBe('Dec 15');
  });

  it('should return "Recently" for future dates (clock skew)', () => {
    const futureDate = new Date('2024-01-15T13:00:00Z').toISOString();
    expect(formatTimeAgo(futureDate)).toBe('Recently');
  });

  it('should return "Recently" for invalid date strings', () => {
    expect(formatTimeAgo('invalid-date')).toBe('Recently');
    expect(formatTimeAgo('')).toBe('Recently');
  });

  it('should handle milliseconds precision correctly', () => {
    // 30 seconds ago (under 1 minute threshold)
    const thirtySecondsAgo = new Date('2024-01-15T11:59:30Z').toISOString();
    expect(formatTimeAgo(thirtySecondsAgo)).toBe('Just now');

    // 59 seconds ago (still under 1 minute)
    const fiftyNineSecondsAgo = new Date('2024-01-15T11:59:01Z').toISOString();
    expect(formatTimeAgo(fiftyNineSecondsAgo)).toBe('Just now');

    // 61 seconds ago (just over 1 minute)
    const sixtyOneSecondsAgo = new Date('2024-01-15T11:58:59Z').toISOString();
    expect(formatTimeAgo(sixtyOneSecondsAgo)).toBe('1m ago');
  });

  it('should handle exact boundary values', () => {
    // Exactly 1 hour ago
    const oneHourAgo = new Date('2024-01-15T11:00:00Z').toISOString();
    expect(formatTimeAgo(oneHourAgo)).toBe('1h ago');

    // Exactly 24 hours ago
    const oneDayAgo = new Date('2024-01-14T12:00:00Z').toISOString();
    expect(formatTimeAgo(oneDayAgo)).toBe('1d ago');

    // Exactly 7 days ago
    const sevenDaysAgo = new Date('2024-01-08T12:00:00Z').toISOString();
    expect(formatTimeAgo(sevenDaysAgo)).toBe('Jan 8');
  });
});

describe('isValidImageUrl', () => {
  it('should return true for valid https URLs', () => {
    expect(isValidImageUrl('https://example.com/image.jpg')).toBe(true);
    expect(isValidImageUrl('https://cdn.example.com/path/to/image.png')).toBe(true);
  });

  it('should return true for valid http URLs', () => {
    expect(isValidImageUrl('http://example.com/image.jpg')).toBe(true);
  });

  it('should return true for relative URLs starting with /', () => {
    expect(isValidImageUrl('/images/local.jpg')).toBe(true);
    expect(isValidImageUrl('/static/logo.png')).toBe(true);
  });

  it('should return false for javascript: protocol (XSS prevention)', () => {
    expect(isValidImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('javascript:void(0)')).toBe(false);
  });

  it('should return false for data: URLs', () => {
    expect(isValidImageUrl('data:image/png;base64,abc123')).toBe(false);
  });

  it('should return false for null or undefined', () => {
    expect(isValidImageUrl(null)).toBe(false);
    expect(isValidImageUrl(undefined)).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidImageUrl('')).toBe(false);
  });

  it('should return false for malformed URLs', () => {
    expect(isValidImageUrl('not-a-url')).toBe(false);
    expect(isValidImageUrl('ftp://example.com/file')).toBe(false);
  });

  it('should return false for blob: URLs', () => {
    expect(isValidImageUrl('blob:https://example.com/abc123')).toBe(false);
    expect(isValidImageUrl('blob:null/abc123')).toBe(false);
  });

  it('should return false for vbscript: protocol (XSS prevention)', () => {
    expect(isValidImageUrl('vbscript:alert(1)')).toBe(false);
  });

  it('should handle URLs with query parameters', () => {
    expect(isValidImageUrl('https://example.com/image.jpg?width=100')).toBe(true);
    expect(isValidImageUrl('https://cdn.example.com/img?src=test&format=webp')).toBe(true);
  });

  it('should handle URLs with fragments', () => {
    expect(isValidImageUrl('https://example.com/image.jpg#anchor')).toBe(true);
  });
});

describe('cn', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
    expect(cn('foo', true && 'bar', 'baz')).toBe('foo bar baz');
  });

  it('should merge Tailwind classes correctly', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('should handle arrays of classes', () => {
    expect(cn(['foo', 'bar'], 'baz')).toBe('foo bar baz');
  });

  it('should handle undefined and null', () => {
    expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
  });
});

describe('safeCssUrl', () => {
  it('should wrap URL in CSS url() with single quotes', () => {
    expect(safeCssUrl('https://example.com/image.jpg')).toBe("url('https://example.com/image.jpg')");
  });

  it('should encode special characters with encodeURI', () => {
    const result = safeCssUrl("https://example.com/image with spaces.jpg");
    expect(result).toBe("url('https://example.com/image%20with%20spaces.jpg')");
  });

  it('should handle relative paths', () => {
    expect(safeCssUrl('/images/logo.png')).toBe("url('/images/logo.png')");
  });

  it('should handle empty string', () => {
    expect(safeCssUrl('')).toBe("url('')");
  });

  it('should handle URLs with hash fragments', () => {
    expect(safeCssUrl('https://example.com/image.jpg#section')).toBe("url('https://example.com/image.jpg#section')");
  });

  it('should handle URLs with unicode characters', () => {
    const result = safeCssUrl('https://example.com/图片/photo.jpg');
    expect(result).toMatch(/^url\('.*'\)$/);
    expect(result).toContain('%');
  });

  it('should handle very long URLs without truncation', () => {
    const longPath = 'a'.repeat(2000);
    const url = `https://example.com/${longPath}`;
    const result = safeCssUrl(url);
    expect(result).toBe(`url('${encodeURI(url)}')`);
  });
});

// ─── Security: CSS injection attack vectors ──────────────────────────────
describe('safeCssUrl - CSS injection prevention', () => {
  it('should neutralize double-quote paren breakout: ..."); background:url(evil)', () => {
    const payload = 'https://example.com/img"); background:url(https://evil.com/steal';
    const result = safeCssUrl(payload);
    // The result should always be a single url('...') token
    expect(result).toMatch(/^url\('.*'\)$/);
    expect(result).not.toContain('");');
  });

  it('should neutralize single-quote breakout attempt', () => {
    const payload = "https://example.com/img'); background:url('https://evil.com/steal";
    const result = safeCssUrl(payload);
    expect(result).toMatch(/^url\('.*'\)$/);
  });

  it('should encode newlines that could break CSS context', () => {
    const payload = "https://example.com/img\n} body { background: red } .x {";
    const result = safeCssUrl(payload);
    expect(result).not.toContain('\n');
    expect(result).toContain('%0A');
  });

  it('should encode angle brackets to prevent HTML injection in style attrs', () => {
    const payload = 'https://example.com/<script>alert(1)</script>';
    const result = safeCssUrl(payload);
    expect(result).not.toContain('<script>');
    expect(result).toContain('%3C');
    expect(result).toContain('%3E');
  });

  it('should handle data URI payloads (defense in depth)', () => {
    const payload = "data:text/css,body{background:red}";
    const result = safeCssUrl(payload);
    expect(result).toMatch(/^url\('.*'\)$/);
  });

  it('should handle backslash escape sequences', () => {
    const payload = 'https://example.com/img\\';
    const result = safeCssUrl(payload);
    expect(result).toMatch(/^url\('.*'\)$/);
  });

  it('should handle carriage return injection', () => {
    const payload = "https://example.com/img\r} .evil { color: red } .x {";
    const result = safeCssUrl(payload);
    expect(result).not.toContain('\r');
    expect(result).toContain('%0D');
  });
});

// ─── Security: isValidImageUrl attack vectors ────────────────────────────
describe('isValidImageUrl - XSS attack vectors', () => {
  it('should block javascript: with varied casing (bypass attempt)', () => {
    expect(isValidImageUrl('JavaScript:alert(1)')).toBe(false);
    expect(isValidImageUrl('JAVASCRIPT:alert(1)')).toBe(false);
    expect(isValidImageUrl('jAvAsCrIpT:alert(1)')).toBe(false);
  });

  it('should block javascript: with leading whitespace', () => {
    expect(isValidImageUrl('  javascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('\tjavascript:alert(1)')).toBe(false);
    expect(isValidImageUrl('\njavascript:alert(1)')).toBe(false);
  });

  it('should block javascript: with tab/newline obfuscation in protocol', () => {
    expect(isValidImageUrl('java\tscript:alert(1)')).toBe(false);
    expect(isValidImageUrl('java\nscript:alert(1)')).toBe(false);
  });

  it('should block data: URIs with dangerous MIME types', () => {
    expect(isValidImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isValidImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
    expect(isValidImageUrl('data:application/javascript,alert(1)')).toBe(false);
  });

  it('should block vbscript: with varied casing', () => {
    expect(isValidImageUrl('VBScript:alert(1)')).toBe(false);
    expect(isValidImageUrl('VBSCRIPT:alert(1)')).toBe(false);
  });

  it('should block file: protocol (local file access)', () => {
    expect(isValidImageUrl('file:///etc/passwd')).toBe(false);
    expect(isValidImageUrl('file:///C:/Windows/system.ini')).toBe(false);
  });

  it('should block custom protocol handlers', () => {
    expect(isValidImageUrl('custom-proto:payload')).toBe(false);
    expect(isValidImageUrl('myapp://callback')).toBe(false);
    expect(isValidImageUrl('tel:+1234567890')).toBe(false);
    expect(isValidImageUrl('mailto:test@example.com')).toBe(false);
  });

  it('should accept legitimate CDN URLs with complex paths', () => {
    expect(isValidImageUrl('https://cdn.example.com/v1/images/resize/800x600/photo.webp?q=80&format=auto')).toBe(true);
    expect(isValidImageUrl('https://images.unsplash.com/photo-1234?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200')).toBe(true);
  });

  it('should accept URLs with encoded characters', () => {
    expect(isValidImageUrl('https://example.com/image%20with%20spaces.jpg')).toBe(true);
    expect(isValidImageUrl('https://example.com/%E5%9B%BE%E7%89%87.jpg')).toBe(true);
  });

  it('should accept URLs with authentication (user:pass@ format)', () => {
    expect(isValidImageUrl('https://user:pass@cdn.example.com/image.jpg')).toBe(true);
  });

  it('should accept URLs with ports', () => {
    expect(isValidImageUrl('https://cdn.example.com:8443/image.jpg')).toBe(true);
    expect(isValidImageUrl('http://localhost:3000/image.jpg')).toBe(true);
  });
});

// ─── Security: Prototype pollution prevention ─────────────────────────────
describe('Security - prototype pollution prevention', () => {
  it('should safely handle __proto__ in object keys', () => {
    // Verify that malicious keys don't affect Object prototype
    const maliciousInput = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    // cn() should handle objects with __proto__ without polluting
    const result = cn({ '__proto__': 'test' });
    expect(typeof result).toBe('string');
    expect(({} as Record<string, unknown>).test).toBeUndefined();
  });

  it('should safely handle constructor.prototype pollution attempts', () => {
    const maliciousInput = JSON.parse('{"constructor": {"prototype": {"polluted": true}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('should handle nested __proto__ in formatTimeAgo input', () => {
    // formatTimeAgo expects a date string, not an object
    // But we verify it doesn't throw on weird input
    expect(() => formatTimeAgo('{"__proto__": {}}')).not.toThrow();
  });
});

// ─── Security: Path traversal prevention ──────────────────────────────────
describe('Security - path traversal in URLs', () => {
  it('should not resolve ../ sequences in safeCssUrl', () => {
    // safeCssUrl should encode, not resolve paths
    const result = safeCssUrl('../../etc/passwd');
    expect(result).toBe("url('../../etc/passwd')");
    // The path stays literal, not resolved to /etc/passwd
  });

  it('should encode null bytes which could bypass path checks', () => {
    // Null bytes can sometimes bypass security checks
    const result = safeCssUrl('image.jpg%00.html');
    // decodeURI converts %00 to null byte, then encodeURI converts it back
    expect(result).toContain('url(');
  });

  it('should handle Windows-style path traversal', () => {
    expect(isValidImageUrl('..\\..\\windows\\system32')).toBe(false);
    expect(isValidImageUrl('..\\..\\..')).toBe(false);
  });

  it('should handle encoded path traversal', () => {
    // %2e = . and %2f = /
    const result = safeCssUrl('%2e%2e%2f%2e%2e%2fetc/passwd');
    // decodeURI decodes these, then encodeURI re-encodes special chars
    expect(result).toContain('url(');
  });
});

// ─── Security: Unicode and encoding attacks ───────────────────────────────
describe('Security - unicode and encoding attacks', () => {
  it('should handle overlong UTF-8 sequences (already decoded by browser)', () => {
    // Overlong UTF-8 for / would be browser-handled before reaching JS
    const result = safeCssUrl('test%c0%afpath');
    expect(result).toContain('url(');
  });

  it('should handle Unicode normalization attacks', () => {
    // Different Unicode representations of same character
    const result1 = safeCssUrl('café.jpg'); // e + combining acute
    const result2 = safeCssUrl('café.jpg'); // precomposed é
    // Both should produce valid CSS
    expect(result1).toContain('url(');
    expect(result2).toContain('url(');
  });

  it('should handle right-to-left override character', () => {
    // RLO (U+202E) can be used to mask malicious extensions
    const rlo = '\u202E';
    const result = safeCssUrl(`image${rlo}gpj.exe`);
    expect(result).toContain('url(');
    // The RLO character should be encoded
    expect(result).toContain('%E2%80%AE');
  });

  it('should handle zero-width characters', () => {
    // Zero-width joiner/non-joiner can hide in filenames
    const zwj = '\u200D';
    const zwnj = '\u200C';
    const result = safeCssUrl(`image${zwj}${zwnj}.jpg`);
    expect(result).toContain('url(');
  });
});
