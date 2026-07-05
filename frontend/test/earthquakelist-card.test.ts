import { describe, it, expect, afterEach } from 'vitest';
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

    expect(card.shadowRoot?.querySelector('.alert-badge')).not.toBeNull();
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
