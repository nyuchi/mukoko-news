'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/**
 * A searchable multi-select: a dropdown to choose from, and the chosen values
 * shown as removable badges beneath it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The preference pickers rendered every option as a chip inline — all 54
 * African countries, then every interest. That made `/profile` several screens
 * tall on a phone and pushed everything below it (organizations, publisher,
 * settings) out of reach, and it got worse with each country added. The set a
 * reader has chosen is small; the set they can choose from is not. Only the
 * former belongs on the page.
 *
 * There is no combobox primitive in this project — Radix ships a dropdown
 * *menu*, whose built-in typeahead fights an embedded search field — so this
 * implements the listbox pattern directly: `aria-expanded` /
 * `aria-haspopup="listbox"` on the trigger, `role="option"` with `aria-selected`
 * on each row, arrow-key navigation with the active row mirrored through
 * `aria-activedescendant`, Enter/Space to toggle, Escape to close and return
 * focus to the trigger.
 *
 * The panel stays open across selections. Choosing four countries should be
 * four clicks, not four click-reopen cycles.
 */

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Rendered before the label — an emoji flag here, decorative only. */
  icon?: string;
}

export function MultiSelect({
  options,
  selected,
  onToggle,
  triggerLabel,
  searchPlaceholder = 'Search',
  emptyText = 'Nothing matches',
  disabled = false,
  renderBadge,
  'aria-describedby': describedBy,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Text on the closed trigger, e.g. "Add a country". */
  triggerLabel: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /**
   * Override the badge for a selected value. Countries use this to carry the
   * "primary" affordance; interests take the default.
   */
  renderBadge?: (option: MultiSelectOption) => React.ReactNode;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Keep the active row inside the filtered list as the query narrows it.
  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? 0 : i));
  }, [filtered.length]);

  // Close on an outside press. `pointerdown` rather than `click` so the panel is
  // gone before a click lands on whatever is underneath it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Scroll the active option into view. Without this, arrow-keying past the
  // bottom of the visible rows moves aria-activedescendant somewhere a sighted
  // keyboard user cannot see — the screen reader announces an option that is
  // off-screen, and the two experiences diverge.
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector(`#${CSS.escape(optionId(activeIndex))}`);
    // Feature-checked: jsdom (and some embedded webviews) do not implement
    // scrollIntoView, and an unguarded call throws during render there.
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  });

  function close(returnFocus = true) {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((i) => (i + step + filtered.length) % filtered.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : filtered.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) onToggle(option.value);
    }
  }

  const selectedOptions = selected
    .map((value) => byValue.get(value))
    .filter((o): o is MultiSelectOption => !!o);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        className="w-full inline-flex items-center justify-between gap-2 px-3 min-h-[var(--touch-input,43px)] rounded-xl border border-elevated bg-background text-sm text-text-secondary hover:bg-elevated disabled:opacity-50 disabled:hover:bg-background transition-colors"
      >
        <span>{triggerLabel}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 w-full rounded-xl border border-elevated bg-surface shadow-lg overflow-hidden"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 px-3 border-b border-elevated">
            <Search className="w-4 h-4 text-text-tertiary shrink-0" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={filtered.length ? optionId(activeIndex) : undefined}
              className="w-full py-2.5 bg-transparent text-sm outline-none placeholder:text-text-secondary"
            />
          </div>

          {/* A div, not a ul. `role="option"` must be a DIRECT child of
              `role="listbox"`, and a <li> in between breaks that relationship —
              axe reports it as aria-required-parent (critical) plus a
              listitem violation, because a <li> under role="listbox" is no
              longer in a list. Options are divs rather than buttons for the
              same reason: a focusable control inside an option is announced as
              a button, not a selectable row. Keyboard interaction lives on the
              search input via aria-activedescendant, which is the listbox
              pattern this implements.

              tabIndex={0} on the container: the rows themselves are not
              focusable (that is the aria-activedescendant pattern), which left
              the scroll region with no focusable content at all — axe reports it
              as scrollable-region-focusable, and a keyboard user who tabs rather
              than arrows really can be stranded. It costs one tab stop, and only
              while the panel is open. Arrow keys work from either the search
              input or the list, because the handler sits on the panel that
              contains both. */}
          <div
            id={listId}
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-multiselectable="true"
            aria-label={triggerLabel}
            className="max-h-64 overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-text-secondary">{emptyText}</p>
            ) : (
              filtered.map((option, i) => {
                const isSelected = selected.includes(option.value);
                return (
                  <div
                    key={option.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => onToggle(option.value)}
                    className={`w-full flex items-center gap-2 px-3 min-h-[var(--touch-dense,37px)] text-left text-sm cursor-pointer transition-colors ${
                      i === activeIndex ? 'bg-elevated' : ''
                    }`}
                  >
                    {option.icon && <span aria-hidden="true">{option.icon}</span>}
                    <span className="flex-1 truncate">{option.label}</span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {selectedOptions.length > 0 && (
        <ul className="flex flex-wrap gap-2 mt-3">
          {selectedOptions.map((option) => (
            <li key={option.value}>
              {renderBadge ? (
                renderBadge(option)
              ) : (
                <SelectedBadge option={option} onRemove={() => onToggle(option.value)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The default badge: the label, and an × that removes it.
 *
 * The × is its own button rather than the whole badge being clickable, because
 * the countries badge makes the body itself do something else (set primary) and
 * both variants should remove the same way.
 */
export function SelectedBadge({
  option,
  onRemove,
  children,
  tone = 'default',
}: {
  option: MultiSelectOption;
  onRemove: () => void;
  children?: React.ReactNode;
  tone?: 'default' | 'primary';
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 pl-3 pr-1 min-h-[var(--touch-chip,31px)] rounded-full text-sm ${
        tone === 'primary'
          ? 'bg-primary text-on-primary font-medium'
          : 'bg-container-tanzanite text-on-container-tanzanite'
      }`}
    >
      {children ?? (
        <>
          {option.icon && <span aria-hidden="true">{option.icon}</span>}
          {option.label}
        </>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${option.label}`}
        className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
