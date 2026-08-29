import { describe, it, expect, afterEach, vi } from 'vitest';
import { EarthquakeListCard } from '../src/earthquakelist-card';
import { EarthquakeListCardConfig, HomeAssistant } from '../src/types';

function makeHass(overrides: Partial<HomeAssistant> = {}): HomeAssistant {
  return {
    states: {},
    entities: {},
    devices: {},
    localize: (key: string) => key,
    language: 'en',
    locale: { language: 'en', number_format: 'comma_decimal', time_format: '24' },
    callWS: async () => ({}) as never,
    ...overrides,
  } as HomeAssistant;
}

describe('EarthquakeListCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is defined', () => {
    expect(customElements.get('earthquakelist-card')).toBeDefined();
  });

  it('throws if no places are configured', () => {
    const card = new EarthquakeListCard();
    expect(() => card.setConfig({ type: 'custom:earthquakelist-card', places: [] })).toThrow();
  });

  it('applies default show_map/show_list/max_list_items', () => {
    const card = new EarthquakeListCard();
    card.setConfig({ type: 'custom:earthquakelist-card', places: ['sensor.earthquakelist_corfu_latest_earthquake'] });
    const config = (card as unknown as { _config: EarthquakeListCardConfig })._config;
    expect(config.show_map).toBe(true);
    expect(config.show_list).toBe(true);
    expect(config.max_list_items).toBe(5);
  });

  it('renders the magnitude, place and distance for a configured entity', async () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '4.0',
          last_changed: '',
          last_updated: '',
          attributes: {
            friendly_name: 'Corfu Latest Earthquake',
            monitored_place: 'Corfu',
            place: 'Corfu',
            location: '11 km SE of Himarë, Albania',
            time: '2026-06-12T04:42:08+00:00',
            distance_km: 45,
            direction: 'N',
            depth_km: 10,
            latitude: 40.022,
            longitude: 19.8391,
            alert_tsunami: false,
          },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    const text = card.shadowRoot?.textContent ?? '';
    expect(text).toContain('Corfu');
    expect(text).toContain('4.0');
    expect(text).toContain('45');
  });

  it('fires hass-more-info with the entity id when the entity-info icon is clicked', async () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '4.0',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Corfu', place: 'Corfu' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    const moreInfoSpy = vi.fn();
    card.addEventListener('hass-more-info', moreInfoSpy);

    const infoButton = card.shadowRoot?.querySelector('.entity-info-button') as HTMLElement;
    expect(infoButton.getAttribute('role')).toBe('button');
    infoButton.click();

    expect(moreInfoSpy).toHaveBeenCalledTimes(1);
    expect((moreInfoSpy.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId });
  });

  it('shows the tsunami alert badge when alert_tsunami is true', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '7.1',
          last_changed: '',
          last_updated: '',
          attributes: {
            monitored_place: 'Japan',
            place: 'Sendai',
            alert_tsunami: true,
            alert_level: 'red',
          },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('.alert-badge.tsunami')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.alert-badge.impact-red')).not.toBeNull();
    // Both badges share one row container rather than stacking.
    expect(card.shadowRoot?.querySelectorAll('.alert-badges > .alert-badge')).toHaveLength(2);
  });

  it('does not show a tsunami alert for a green PAGER level', async () => {
    // Regression: `alert_level` used to also trigger the tsunami badge, so every quake with
    // the routine green ("no response needed") PAGER level was labelled a tsunami alert.
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '5.6',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', place: 'Sendai', alert_tsunami: false, alert_level: 'green' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('.alert-badge')).toBeNull();
    expect(card.shadowRoot?.textContent).not.toContain('Tsunami');
  });

  it('shows an impact-level badge separately from the tsunami badge', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.8',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', place: 'Sendai', alert_tsunami: false, alert_level: 'orange' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('.alert-badge.tsunami')).toBeNull();
    const impact = card.shadowRoot?.querySelector('.alert-badge.impact-orange');
    expect(impact?.textContent?.trim()).toBe('Orange alert');
  });

  it('marks only the affected list items with a tsunami icon', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = [
      { magnitude: 6.1, place: 'Naha', time: '2026-07-04T00:00:00+00:00', alert_tsunami: true },
      // Green PAGER level is routine — it must not be rendered as a tsunami icon.
      { magnitude: 5.7, place: 'Kōfu', time: '2026-07-03T00:00:00+00:00', alert_tsunami: false, alert_level: 'green' },
      { magnitude: 5.1, place: 'Sendai', time: '2026-07-02T00:00:00+00:00', alert_tsunami: false },
      { magnitude: 4.9, place: 'Tokyo', time: '2026-07-01T00:00:00+00:00', alert_tsunami: true },
    ];
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    // earthquakes[0] (Naha) is the summary entry above the list, not a list item
    const items = card.shadowRoot?.querySelectorAll('.quake-item') ?? [];
    expect(items).toHaveLength(3);
    // Kōfu: green PAGER level only — neither a tsunami nor a surfaced impact alert.
    expect(items[0].querySelector('.quake-item-tsunami')).toBeNull();
    expect(items[0].querySelector('.quake-item-impact')).toBeNull();
    // Sendai: no alerts at all.
    expect(items[1].querySelector('.quake-item-tsunami')).toBeNull();
    // Tokyo: a real tsunami alert.
    expect(items[2].querySelector('.quake-item-tsunami')).not.toBeNull();
  });

  it('does not repeat the summary earthquake as the first recent-earthquakes list item', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = [
      { magnitude: 6.1, place: 'Naha', time: '2026-07-02T00:00:00+00:00' },
      { magnitude: 5.1, place: 'Sendai', time: '2026-07-01T00:00:00+00:00' },
    ];
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    const items = card.shadowRoot?.querySelectorAll('.quake-item') ?? [];
    expect(items).toHaveLength(1);
    expect(items[0].querySelector('.quake-item-place')?.textContent).toContain('Sendai');

    // The heading must not claim to show the latest quake, since that one is the summary.
    const heading = card.shadowRoot?.querySelector('.quake-list-title')?.textContent?.trim();
    expect(heading).toBe('Previous Earthquakes');
  });

  it('shows an empty state for an unavailable entity', async () => {
    const entityId = 'sensor.earthquakelist_missing';
    const card = new EarthquakeListCard();
    card.hass = makeHass();
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId] });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('.empty-state')).not.toBeNull();
  });

  it('shows offshore and felt-report info in the summary and list-item meta', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = [
      { magnitude: 6.1, place: 'Naha', time: '2026-07-02T00:00:00+00:00', offshore: true, felt: 312 },
      { magnitude: 5.1, place: 'Sendai', time: '2026-07-01T00:00:00+00:00', offshore: false, felt: 0 },
    ];
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    const summaryMeta = card.shadowRoot?.querySelector('.summary-meta') as HTMLElement;
    const summaryChips = Array.from(summaryMeta.querySelectorAll('.meta-chip'));
    expect(summaryChips.some((chip) => chip.getAttribute('title') === 'Offshore')).toBe(true);
    const feltChip = summaryChips.find((chip) => chip.getAttribute('title') === 'Felt by 312');
    expect(feltChip?.textContent).toContain('312');

    // Sendai (offshore: false, felt: 0) should show neither chip
    const itemMeta = card.shadowRoot?.querySelector('.quake-item-meta') as HTMLElement;
    const itemChips = Array.from(itemMeta.querySelectorAll('.meta-chip'));
    expect(itemChips.some((chip) => chip.getAttribute('title') === 'Offshore')).toBe(false);
    expect(itemChips.some((chip) => (chip.getAttribute('title') ?? '').startsWith('Felt by'))).toBe(false);
  });

  it('renders a news link when news_link is present, using news_title as the label', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = [
      {
        magnitude: 6.1,
        place: 'Naha',
        time: '2026-07-02T00:00:00+00:00',
        news_link: 'https://example.com/article',
        news_title: 'Major earthquake strikes Naha',
      },
    ];
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    const link = card.shadowRoot?.querySelector('a.news-link') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/article');
    expect(link?.textContent).toContain('Major earthquake strikes Naha');
  });

  it('does not render a news link when news_link is absent', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', place: 'Naha', time: '2026-07-02T00:00:00+00:00' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('a.news-link')).toBeNull();
  });

  it('renders one earthquake-list-item per additional earthquake, capped at max_list_items', async () => {
    const entityId = 'sensor.earthquakelist_california_latest_earthquake';
    const earthquakes = Array.from({ length: 8 }, (_, i) => ({
      magnitude: 3 + i * 0.1,
      place: `Place ${i}`,
      time: '2026-06-12T04:42:08+00:00',
    }));
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '3.9',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'California', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false, max_list_items: 3 });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelectorAll('.quake-item').length).toBe(3);
  });
});
