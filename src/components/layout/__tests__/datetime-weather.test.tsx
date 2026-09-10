import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, act } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DateTimeWeather } from '../datetime-weather';
import { formatLocalDateTime } from '@/lib/local-time';
import type { WeatherSnapshot } from '@/lib/weather';

const mockFetchCurrentWeather = vi.fn();

vi.mock('@/lib/weather', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/weather')>();
  return { ...actual, fetchCurrentWeather: () => mockFetchCurrentWeather() };
});

const snapshot: WeatherSnapshot = {
  locationName: 'Harare',
  temp: 24,
  condition: 'Partly cloudy',
  code: 2,
  isDay: true,
  attribution: { name: 'Mukoko Weather', url: 'https://weather.mukoko.com/' },
};

describe('DateTimeWeather', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchCurrentWeather.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the clock', () => {
    it('renders NO time on the server, only a reserved placeholder', () => {
      // The server runs in the datacenter's timezone. Putting a time in the
      // SSR HTML would be wrong for the reader AND a guaranteed hydration
      // mismatch, so the markup carries a placeholder and no <time> at all.
      const html = renderToStaticMarkup(<DateTimeWeather />);
      expect(html).not.toContain('<time');
      // `invisible`, not `hidden` — the placeholder still occupies the row.
      expect(html).toContain('invisible');
      // And it is aria-hidden, so a screen reader is told nothing rather than
      // being read a fake clock.
      expect(html).toContain('aria-hidden="true"');
    });

    it('fills the real local time on mount, in the reader’s own zone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));

      const { container } = render(<DateTimeWeather />);

      const time = container.querySelector('time');
      expect(time).not.toBeNull();
      // Whatever zone the environment is in, the component must agree with
      // formatLocalDateTime() called with NO explicit zone — i.e. the reader's.
      const expected = formatLocalDateTime(new Date('2026-09-10T12:00:00.000Z'));
      expect(time?.textContent).toBe(expected?.display);
      // The machine-readable attribute is the unambiguous UTC instant.
      expect(time).toHaveAttribute('dateTime', '2026-09-10T12:00:00.000Z');
      // The placeholder is gone once the real value is in.
      expect(container.querySelector('.invisible')).toBeNull();

      // Flush the in-flight weather promise so it settles inside act().
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    });

    it('advances as time passes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'));
      const { container } = render(<DateTimeWeather />);

      expect(container.querySelector('time')).toHaveAttribute(
        'dateTime',
        '2026-09-10T12:00:00.000Z'
      );

      // Fake timers move the system clock as they advance, so the component
      // re-reads a genuinely later `new Date()` on each tick.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      const time = container.querySelector('time');
      expect(time).toHaveAttribute('dateTime', '2026-09-10T12:01:00.000Z');
      expect(time?.textContent).toBe(
        formatLocalDateTime(new Date('2026-09-10T12:01:00.000Z'))?.display
      );
    });
  });

  describe('the weather', () => {
    it('shows the temperature, condition and location, credited and linked', async () => {
      mockFetchCurrentWeather.mockResolvedValue(snapshot);
      render(<DateTimeWeather />);

      const link = await screen.findByRole('link', { name: /Weather in Harare/i });
      expect(link).toHaveAttribute('href', 'https://weather.mukoko.com/');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');

      // Temperature is TEXT with its unit, never a bare glyph, and the spoken
      // label spells the unit out in full.
      expect(link).toHaveTextContent('24°C');
      expect(link).toHaveTextContent('Partly cloudy');
      expect(link).toHaveTextContent('Harare');
      expect(link.getAttribute('aria-label')).toContain('24 degrees Celsius');

      // The attribution the API returned is honoured in the accessible name
      // and rendered in the chrome.
      expect(link.getAttribute('aria-label')).toContain('Mukoko Weather');
      expect(link).toHaveTextContent('Mukoko Weather');
    });

    it('honours whatever attribution the API returns rather than hardcoding ours', async () => {
      mockFetchCurrentWeather.mockResolvedValue({
        ...snapshot,
        attribution: { name: 'Open-Meteo', url: 'https://open-meteo.com/' },
      });
      render(<DateTimeWeather />);

      const link = await screen.findByRole('link', { name: /Open-Meteo/i });
      expect(link).toHaveAttribute('href', 'https://open-meteo.com/');
    });

    it('renders a null temperature as simply absent, not as "null°C"', async () => {
      // Every numeric in the embed payload is `number | null`.
      mockFetchCurrentWeather.mockResolvedValue({
        ...snapshot,
        temp: null,
        code: null,
        locationName: null,
      });
      render(<DateTimeWeather />);

      const link = await screen.findByRole('link', { name: /Current weather/i });
      expect(link).toHaveTextContent('Partly cloudy');
      expect(link.textContent).not.toMatch(/null|NaN|undefined|°C/);
      // No location name means no claim about whose weather it is, and no
      // temperature means the label never says "degrees".
      expect(link.getAttribute('aria-label')).not.toContain('Weather in');
      expect(link.getAttribute('aria-label')).not.toContain('degrees');
    });

    it('renders a temperature with no condition', async () => {
      mockFetchCurrentWeather.mockResolvedValue({ ...snapshot, condition: null });
      render(<DateTimeWeather />);
      const link = await screen.findByRole('link', { name: /Weather in Harare/i });
      expect(link).toHaveTextContent('24°C');
      expect(link).not.toHaveTextContent('Partly cloudy');
    });

    it('shows nothing at all when the API is unavailable — and keeps the clock', async () => {
      // fetchCurrentWeather resolves null for every failure mode: offline,
      // CORS, 5xx, timeout, junk body, empty payload. The strip stays a strip.
      mockFetchCurrentWeather.mockResolvedValue(null);
      const { container } = render(<DateTimeWeather />);

      await waitFor(() => expect(mockFetchCurrentWeather).toHaveBeenCalled());
      expect(screen.queryByRole('link')).toBeNull();
      expect(screen.getByTestId('datetime-weather')).toBeInTheDocument();
      expect(container.querySelector('time')).not.toBeNull();
    });

    it('does not blow up if the fetch helper ever rejects', async () => {
      // Belt and braces: the helper swallows everything today, but the header
      // must not be the thing that breaks if that ever changes.
      mockFetchCurrentWeather.mockRejectedValue(new Error('boom'));
      const { container } = render(<DateTimeWeather />);

      await waitFor(() => expect(mockFetchCurrentWeather).toHaveBeenCalled());
      expect(screen.queryByRole('link')).toBeNull();
      expect(container.querySelector('time')).not.toBeNull();
    });

    it('reserves its height so late weather cannot shift the layout', async () => {
      const { container } = render(<DateTimeWeather />);
      const strip = container.querySelector('[data-testid="datetime-weather"]');
      // Height comes from a density token, not a magic pixel value, and it is
      // present before any data arrives.
      expect(strip?.className).toContain('min-h-[var(--touch-chip)]');
      await act(async () => {});
    });

    it('stops polling once unmounted', async () => {
      vi.useFakeTimers();
      mockFetchCurrentWeather.mockResolvedValue(snapshot);
      const { unmount } = render(<DateTimeWeather />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const callsWhileMounted = mockFetchCurrentWeather.mock.calls.length;
      expect(callsWhileMounted).toBe(1);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60 * 60_000);
      });

      expect(mockFetchCurrentWeather.mock.calls.length).toBe(callsWhileMounted);
    });
  });

  it('is styled with Mzizi semantic tokens only — no raw Tailwind palette', () => {
    // The owner's standing rule: no bg-blue-500 / text-gray-400 / bg-slate-*.
    // Scanned over the source so the branches that only render with live
    // weather are covered too, not just what this test happened to mount.
    const source = readFileSync(
      resolve(__dirname, '..', 'datetime-weather.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(
      /\b(?:bg|text|border|from|via|to|ring|fill|stroke|divide|outline|shadow|accent|caret|decoration)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/
    );
    // …and no inline styles either.
    expect(source).not.toMatch(/style=\{\{/);
  });
});
