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

  it('throws if places is missing entirely', () => {
    const card = new EarthquakeListCard();
    expect(() => card.setConfig({ type: 'custom:earthquakelist-card' } as EarthquakeListCardConfig)).toThrow();
  });

  it('throws for a place that is not a sensor entity', () => {
    const card = new EarthquakeListCard();
    expect(() => card.setConfig({ type: 'custom:earthquakelist-card', places: ['sun.sun'] })).toThrow('sun.sun');
  });

  it('accepts the stub config the card picker builds, so the preview is not an error tile', () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';
    const hass = makeHass({
      entities: { [entityId]: { entity_id: entityId, platform: 'earthquakelist' } },
    });

    const stub = EarthquakeListCard.getStubConfig(hass, [entityId, 'sun.sun']);

    expect(stub.places).toEqual([entityId]);
    expect(() => new EarthquakeListCard().setConfig(stub)).not.toThrow();
  });

  it('renders a hint instead of throwing when the stub config found no entity', async () => {
    const stub = EarthquakeListCard.getStubConfig();
    expect(stub.places).toEqual([]);

    const card = new EarthquakeListCard();
    card.hass = makeHass();
    expect(() => card.setConfig(stub)).not.toThrow();
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('.empty-state')?.textContent).toContain('Pick at least one place');
  });

  it('never reports a card size of 0, not even for the empty stub config', () => {
    // An empty `places` became legal when setConfig stopped throwing for it. Masonry
    // balances its columns by getCardSize(), so a 0 makes the card weightless there.
    const card = new EarthquakeListCard();
    card.setConfig(EarthquakeListCard.getStubConfig());
    expect(card.getCardSize()).toBe(3);

    const twoPlaces = new EarthquakeListCard();
    twoPlaces.setConfig({
      type: 'custom:earthquakelist-card',
      places: ['sensor.earthquakelist_corfu_latest_earthquake', 'sensor.earthquakelist_japan_latest_earthquake'],
    });
    expect(twoPlaces.getCardSize()).toBe(6);
  });

  // A change-detector for the literal, nothing more - it cannot show that Home Assistant
  // reads any of it. The proof is card.spec.ts's sections-dashboard test, which asserts
  // HA clamps the card to the min_columns reported here.
  it('reports grid options so a sections dashboard can size the map', () => {
    const card = new EarthquakeListCard();
    expect(card.getGridOptions()).toEqual({ columns: 'full', rows: 'auto', min_columns: 6, min_rows: 3 });
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

  describe('place name', () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';

    async function renderName(overrides: Partial<HomeAssistant>, attributes: Record<string, unknown>) {
      const card = new EarthquakeListCard();
      card.hass = makeHass({
        states: {
          [entityId]: { entity_id: entityId, state: '4.0', last_changed: '', last_updated: '', attributes },
        },
        ...overrides,
      });
      card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
      document.body.appendChild(card);
      await card.updateComplete;
      return card.shadowRoot?.querySelector('.place-name')?.textContent;
    }

    it('follows a renamed device through hass.formatEntityName', async () => {
      const formatEntityName = vi.fn(() => 'Kerkyra');

      const name = await renderName(
        { entities: { [entityId]: { entity_id: entityId, device_id: 'dev1' } }, formatEntityName },
        { monitored_place: 'Corfu', place: 'Corfu' },
      );

      expect(name).toBe('Kerkyra');
      expect(formatEntityName).toHaveBeenCalledWith(expect.objectContaining({ entity_id: entityId }), {
        type: 'device',
      });
    });

    it('names a sensor with no data after its device, not after the full friendly name', async () => {
      // With no match the sensor exposes no attributes of its own, so monitored_place
      // is missing and friendly_name ("Corfu Latest Earthquake") used to take over.
      const name = await renderName(
        {
          entities: { [entityId]: { entity_id: entityId, device_id: 'dev1' } },
          formatEntityName: () => 'Corfu',
        },
        { friendly_name: 'Corfu Latest Earthquake' },
      );

      expect(name).toBe('Corfu');
    });

    it('falls back to monitored_place without the formatter or without a device', async () => {
      expect(await renderName({}, { monitored_place: 'Corfu', friendly_name: 'Corfu Latest Earthquake' })).toBe(
        'Corfu',
      );
      document.body.innerHTML = '';

      const formatEntityName = vi.fn(() => '');
      expect(
        await renderName({ formatEntityName }, { monitored_place: 'Corfu', friendly_name: 'Corfu Latest Earthquake' }),
      ).toBe('Corfu');
      expect(formatEntityName).not.toHaveBeenCalled();
    });

    it('falls back to the friendly name, then the entity id', async () => {
      expect(await renderName({}, { friendly_name: 'Corfu Latest Earthquake' })).toBe('Corfu Latest Earthquake');
      document.body.innerHTML = '';

      expect(await renderName({}, {})).toBe(entityId);
    });
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

  it('still renders when alert_level is the boolean the API sends for "no alert"', async () => {
    // The API returns the JSON boolean false rather than null, and this runs
    // inside render() - so calling a string method on it used to throw and
    // leave the user with a blank card and no error at all.
    const entityId = 'sensor.earthquakelist_nowhere_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '5.6',
          last_changed: '',
          last_updated: '',
          attributes: {
            monitored_place: 'Nowhere',
            earthquakes: [
              {
                id: 'e1',
                magnitude: 5.6,
                place: 'Nowhere',
                location: '11 km SE of Nowhere',
                alert_level: false,
                alert_tsunami: false,
              },
            ],
          },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], show_map: false });
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.shadowRoot?.querySelector('ha-card')).not.toBeNull();
    expect(card.shadowRoot?.querySelector('.summary-location')?.textContent?.trim()).toBe('Nowhere');
    expect(card.shadowRoot?.querySelector('.magnitude-badge')?.textContent?.trim()).toBe('5.6');
    expect(card.shadowRoot?.querySelector('.alert-badge.impact-red')).toBeNull();
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

    const tsunami = card.shadowRoot?.querySelector('.alert-badge.tsunami');
    expect(tsunami).not.toBeNull();
    // USGS only flags "large event in an oceanic region", so the badge must not claim an
    // issued warning, and must carry the qualifier as a tooltip.
    expect(tsunami?.textContent?.trim()).toBe('Tsunami possible');
    expect(tsunami?.getAttribute('title')).toContain('not a confirmed warning');

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

  it('passes every earthquake to the map by default, independent of max_list_items', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = Array.from({ length: 10 }, (_, i) => ({
      magnitude: 5 + i * 0.1,
      place: `Place ${i}`,
      time: '2026-07-02T00:00:00+00:00',
      latitude: 35 + i,
      longitude: 139 + i,
    }));
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '5.0',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], max_list_items: 3 });
    document.body.appendChild(card);
    await card.updateComplete;

    const map = card.shadowRoot?.querySelector('earthquakelist-map') as unknown as {
      earthquakes: unknown[];
    };
    // The map deliberately shows more than the list: it has room for surrounding context.
    expect(map.earthquakes).toHaveLength(10);
    expect(card.shadowRoot?.querySelectorAll('.quake-item')).toHaveLength(3);
  });

  it('caps map markers at max_map_markers when set', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const earthquakes = Array.from({ length: 10 }, (_, i) => ({
      magnitude: 5 + i * 0.1,
      place: `Place ${i}`,
      time: '2026-07-02T00:00:00+00:00',
      latitude: 35 + i,
      longitude: 139 + i,
    }));
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '5.0',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Japan', earthquakes },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId], max_map_markers: 4 });
    document.body.appendChild(card);
    await card.updateComplete;

    const map = card.shadowRoot?.querySelector('earthquakelist-map') as unknown as {
      earthquakes: { place?: string }[];
    };
    expect(map.earthquakes).toHaveLength(4);
    // Keeps the most recent ones, not an arbitrary slice.
    expect(map.earthquakes[0].place).toBe('Place 0');
  });

  it('names the entity when it does not exist, instead of claiming there is no data', async () => {
    const entityId = 'sensor.earthquakelist_typo';
    const card = new EarthquakeListCard();
    card.hass = makeHass();
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId] });
    document.body.appendChild(card);
    await card.updateComplete;

    const empty = card.shadowRoot?.querySelector('.empty-state');
    expect(empty?.textContent).toContain(entityId);
    expect(empty?.textContent).not.toContain('No earthquake data yet');
    expect(empty?.classList.contains('error')).toBe(true);
  });

  it('says the sensor is unavailable rather than empty when the upstream fetch failed', async () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: 'unavailable',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Corfu' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId] });
    document.body.appendChild(card);
    await card.updateComplete;

    const empty = card.shadowRoot?.querySelector('.empty-state');
    expect(empty?.textContent).toContain('unavailable');
    expect(empty?.textContent).not.toContain('No earthquake data yet');
  });

  // Regression guard, not fix-proving: the third empty state is the one that already
  // existed, and this pins that splitting out the other two did not swallow it.
  it('keeps the plain empty state for a sensor that simply matched nothing', async () => {
    const entityId = 'sensor.earthquakelist_corfu_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: 'unknown',
          last_changed: '',
          last_updated: '',
          attributes: { monitored_place: 'Corfu' },
        },
      },
    });
    card.setConfig({ type: 'custom:earthquakelist-card', places: [entityId] });
    document.body.appendChild(card);
    await card.updateComplete;

    const empty = card.shadowRoot?.querySelector('.empty-state');
    expect(empty?.textContent).toContain('No earthquake data yet');
    expect(empty?.classList.contains('error')).toBe(false);
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
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    // The headline only restates the row's own magnitude and place, so it is the tooltip
    // and the link text stays short.
    expect(link?.textContent?.trim()).toBe('Read more');
    expect(link?.getAttribute('title')).toBe('Major earthquake strikes Naha');
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

  it('drops a news link whose URL is not http(s)', async () => {
    const entityId = 'sensor.earthquakelist_japan_latest_earthquake';
    const card = new EarthquakeListCard();
    card.hass = makeHass({
      states: {
        [entityId]: {
          entity_id: entityId,
          state: '6.1',
          last_changed: '',
          last_updated: '',
          attributes: {
            monitored_place: 'Japan',
            earthquakes: [
              {
                magnitude: 6.1,
                place: 'Naha',
                time: '2026-07-02T00:00:00+00:00',
                news_link: 'javascript:alert(1)',
              },
            ],
          },
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
