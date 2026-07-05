import { describe, it, expect, vi, afterEach } from 'vitest';
import { EarthquakeListMap } from '../src/components/map';
import { EarthquakeListItem, HomeAssistant } from '../src/types';

function makeHass(): HomeAssistant {
  return {
    states: {},
    entities: {},
    devices: {},
    localize: (key: string) => key,
    language: 'en',
    locale: { language: 'en', number_format: 'comma_decimal', time_format: '24' },
    callWS: async () => ({}) as never,
  } as HomeAssistant;
}

function makeQuake(overrides: Partial<EarthquakeListItem> = {}): EarthquakeListItem {
  return {
    id: 'quake-1',
    magnitude: 4.2,
    latitude: 40.0,
    longitude: 19.8,
    place: 'Corfu',
    time: '2026-06-12T04:42:08+00:00',
    ...overrides,
  };
}

async function waitForMap(el: EarthquakeListMap): Promise<void> {
  await vi.waitFor(() => {
    expect(el.shadowRoot?.querySelector('.leaflet-container')).not.toBeNull();
  });
  // let the async marker rendering (which awaits the dynamic leaflet import) settle
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EarthquakeListMap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is defined', () => {
    expect(customElements.get('earthquakelist-map')).toBeDefined();
  });

  it('initializes a Leaflet map and renders one marker per earthquake', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake(), makeQuake({ id: 'quake-2', latitude: 41.0, longitude: 20.1 })];
    document.body.appendChild(el);

    await waitForMap(el);

    const markers = (el as unknown as { _quakeMarkers: Map<string, unknown> })._quakeMarkers;
    expect(markers.size).toBe(2);
  });

  it('removes markers for earthquakes no longer in the list', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake({ id: 'quake-1' }), makeQuake({ id: 'quake-2', latitude: 41.0, longitude: 20.1 })];
    document.body.appendChild(el);
    await waitForMap(el);

    el.earthquakes = [makeQuake({ id: 'quake-1' })];
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const markers = (el as unknown as { _quakeMarkers: Map<string, unknown> })._quakeMarkers;
    expect(markers.size).toBe(1);
    expect(markers.has('quake-1')).toBe(true);
  });

  it('stops auto-fitting bounds once the user has manually interacted with the map', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    const mapInstance = (el as unknown as { _map: { fitBounds: (...args: unknown[]) => void } })._map;
    const fitBoundsSpy = vi.spyOn(mapInstance, 'fitBounds');

    (el as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap = true;
    el.earthquakes = [...el.earthquakes, makeQuake({ id: 'quake-2', latitude: 42.0, longitude: 21.0 })];
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fitBoundsSpy).not.toHaveBeenCalled();
  });

  it('renders an accessible recenter control', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    const recenter = el.shadowRoot?.querySelector('a.recenter-button');
    expect(recenter).not.toBeNull();
    expect(recenter?.getAttribute('role')).toBe('button');
    expect(recenter?.getAttribute('aria-label')).toBe('Recenter map');
  });

  it('re-enables auto-fit when the recenter control is clicked', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    (el as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap = true;
    const recenter = el.shadowRoot?.querySelector('a.recenter-button') as HTMLAnchorElement;
    recenter.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((el as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap).toBe(false);
  });

  it('tears down the map on disconnect', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    el.remove();

    expect((el as unknown as { _map: unknown })._map).toBeUndefined();
  });
});
