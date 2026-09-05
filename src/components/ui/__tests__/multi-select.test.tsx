import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MultiSelect, type MultiSelectOption } from '../multi-select';

/**
 * The picker exists to keep the page short: the set a reader has chosen is
 * small, the set they can choose from is not, and only the former should be on
 * the page. So most of what is asserted here is that unchosen options stay out
 * of the document until the dropdown is opened.
 */

const OPTIONS: MultiSelectOption[] = [
  { value: 'NG', label: 'Nigeria', icon: '🇳🇬' },
  { value: 'ZA', label: 'South Africa', icon: '🇿🇦' },
  { value: 'ZW', label: 'Zimbabwe', icon: '🇿🇼' },
];

function setup(selected: string[] = [], onToggle = vi.fn()) {
  const utils = render(
    <MultiSelect
      options={OPTIONS}
      selected={selected}
      onToggle={onToggle}
      triggerLabel="Add a country"
      searchPlaceholder="Search countries"
      emptyText="No country matches that."
    />
  );
  return { ...utils, onToggle };
}

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /add a country/i }));
const listbox = () => screen.getByRole('listbox');

beforeEach(() => vi.clearAllMocks());

describe('MultiSelect', () => {
  it('shows only the selected values until it is opened', () => {
    setup(['ZW']);
    expect(screen.getByText('Zimbabwe')).toBeInTheDocument();
    // The other 2 options are not on the page — this is the whole point.
    expect(screen.queryByText('Nigeria')).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reveals every option once opened', () => {
    setup(['ZW']);
    openPanel();
    const options = within(listbox()).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(within(listbox()).getByRole('option', { name: /Nigeria/ })).toBeInTheDocument();
  });

  it('marks the already-selected options as selected', () => {
    setup(['ZW']);
    openPanel();
    expect(within(listbox()).getByRole('option', { name: /Zimbabwe/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(listbox()).getByRole('option', { name: /Nigeria/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('filters by the search field', () => {
    setup();
    openPanel();
    fireEvent.change(screen.getByPlaceholderText('Search countries'), {
      target: { value: 'south' },
    });
    const options = within(listbox()).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName(/South Africa/);
  });

  it('says so when the search matches nothing', () => {
    setup();
    openPanel();
    fireEvent.change(screen.getByPlaceholderText('Search countries'), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText('No country matches that.')).toBeInTheDocument();
    expect(within(listbox()).queryAllByRole('option')).toHaveLength(0);
  });

  it('toggles a value and keeps the panel open for the next pick', () => {
    const { onToggle } = setup();
    openPanel();
    fireEvent.click(within(listbox()).getByRole('option', { name: /Nigeria/ }));
    expect(onToggle).toHaveBeenCalledWith('NG');
    // Choosing four countries should be four clicks, not four reopen cycles.
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('removes a selected value from its badge', () => {
    const { onToggle } = setup(['ZW']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Zimbabwe' }));
    expect(onToggle).toHaveBeenCalledWith('ZW');
  });

  it('closes on Escape', () => {
    setup();
    openPanel();
    fireEvent.keyDown(listbox(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves the active option with the arrow keys and toggles it with Enter', () => {
    const { onToggle } = setup();
    openPanel();
    const search = screen.getByPlaceholderText('Search countries');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('ZA');
  });

  it('wraps the active option around the ends of the list', () => {
    const { onToggle } = setup();
    openPanel();
    const search = screen.getByPlaceholderText('Search countries');
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledWith('ZW');
  });

  it('points aria-activedescendant at the active option', () => {
    setup();
    openPanel();
    const search = screen.getByPlaceholderText('Search countries');
    const active = search.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(within(listbox()).getAllByRole('option')[0]).toHaveAttribute('id', active!);
  });

  it('renders a custom badge when one is supplied', () => {
    render(
      <MultiSelect
        options={OPTIONS}
        selected={['NG']}
        onToggle={vi.fn()}
        triggerLabel="Add a country"
        renderBadge={(o) => <span>custom:{o.label}</span>}
      />
    );
    expect(screen.getByText('custom:Nigeria')).toBeInTheDocument();
  });

  it('ignores a selected value with no matching option', () => {
    // A stored preference for a country the UI no longer lists must not render
    // as an empty badge.
    setup(['XX']);
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('cannot be opened while disabled', () => {
    render(
      <MultiSelect
        options={OPTIONS}
        selected={[]}
        onToggle={vi.fn()}
        triggerLabel="Add an interest"
        disabled
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /add an interest/i }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
