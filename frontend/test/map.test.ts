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

// `maplibre-gl` is module-mocked (vi.hoisted, since vi.mock's factory is hoisted above these
// imports) rather than per-instance: `connectedCallback` fires a real `import('maplibre-gl')`
// synchronously on mount, which a later per-instance mock can't win the race against — and
// unlike Leaflet, MapLibre needs a real WebGL context, so that reliably crashes in jsdom.
const { maplibreMock, mapInstanceMock } = vi.hoisted(() => {
  class MockLngLatBounds {
    private _extended = false;
    private _ne: { lng: number; lat: number } = { lng: 0, lat: 0 };
    private _sw: { lng: number; lat: number } = { lng: 0, lat: 0 };
    extend([lng, lat]: [number, number]) {
      if (!this._extended) {
        this._ne = { lng, lat };
        this._sw = { lng, lat };
      } else {
        this._ne = { lng: Math.max(this._ne.lng, lng), lat: Math.max(this._ne.lat, lat) };
        this._sw = { lng: Math.min(this._sw.lng, lng), lat: Math.min(this._sw.lat, lat) };
      }
      this._extended = true;
      return this;
    }
    isEmpty() {
      return !this._extended;
    }
    getNorthEast() {
      return this._ne;
    }
    getSouthWest() {
      return this._sw;
    }
  }

  function createMarkerInstanceMock(element: HTMLElement) {
    let lngLat: [number, number] | undefined;
    const marker = {
      setLngLat: vi.fn((ll: [number, number]) => {
        lngLat = ll;
        return marker;
      }),
      getLngLat: vi.fn(() => lngLat),
      setPopup: vi.fn(() => marker),
      addTo: vi.fn(() => marker),
      remove: vi.fn(() => marker),
      getElement: vi.fn(() => element),
    };
    return marker;
  }

  const mapInstanceMock = {
    addControl: vi.fn(),
    on: vi.fn(),
    getContainer: vi.fn(() => document.createElement('div')),
    off: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    getZoom: vi.fn(() => 10),
  };

  const maplibreMock = {
    // Mirrors MapLibre's real behavior enough for tests that assert on control DOM (e.g.
    // the recenter button): `addControl` invokes the control's `onAdd()` and appends the
    // resulting element into the map's own container, same as the real implementation does.
    Map: vi.fn().mockImplementation(function (options: { container: HTMLElement }) {
      mapInstanceMock.addControl = vi.fn((control: { onAdd: () => HTMLElement }) => {
        options.container.appendChild(control.onAdd());
      });
      return mapInstanceMock;
    }),
    Marker: vi.fn().mockImplementation(function (options: { element?: HTMLElement }) {
      return createMarkerInstanceMock(options?.element ?? document.createElement('div'));
    }),
    Popup: vi.fn().mockImplementation(function () {
      const popup = {
        html: '',
        setHTML: vi.fn(function (this: { html: string }, html: string) {
          this.html = html;
          return popup;
        }),
      };
      return popup;
    }),
    NavigationControl: vi.fn().mockImplementation(function () {
      return { onAdd: () => document.createElement('div') };
    }),
    AttributionControl: vi.fn().mockImplementation(function () {
      return { onAdd: () => document.createElement('div') };
    }),
    LngLatBounds: MockLngLatBounds,
  };

  return { maplibreMock, mapInstanceMock };
});

vi.mock('maplibre-gl', () => maplibreMock);

async function waitForMap(el: EarthquakeListMap): Promise<void> {
  await vi.waitFor(() => {
    expect((el as unknown as { _map: unknown })._map).toBeDefined();
  });
  // let the async marker rendering (which awaits the dynamic maplibre-gl import) settle
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EarthquakeListMap', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('is defined', () => {
    expect(customElements.get('earthquakelist-map')).toBeDefined();
  });

  it('initializes a MapLibre map and renders one marker per earthquake', async () => {
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

    mapInstanceMock.fitBounds.mockClear();
    mapInstanceMock.jumpTo.mockClear();

    (el as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap = true;
    el.earthquakes = [...el.earthquakes, makeQuake({ id: 'quake-2', latitude: 42.0, longitude: 21.0 })];
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mapInstanceMock.fitBounds).not.toHaveBeenCalled();
    expect(mapInstanceMock.jumpTo).not.toHaveBeenCalled();
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
    // Localized, not hardcoded — makeHass() reports language 'en'.
    expect(recenter?.getAttribute('aria-label')).toBe('Recenter map and enable auto-zoom');
  });

  it('localizes the recenter control instead of hardcoding English', async () => {
    const el = new EarthquakeListMap();
    el.hass = { ...makeHass(), language: 'de' } as HomeAssistant;
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    const recenter = el.shadowRoot?.querySelector('a.recenter-button') as HTMLAnchorElement;
    expect(recenter.getAttribute('aria-label')).toBe('Karte neu zentrieren und Auto-Zoom aktivieren');
    // Auto-zoom is on initially, so the tooltip reports that state.
    expect(recenter.title).toBe('Auto-Zoom aktiv');
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

  it('includes offshore, felt-report and news-link info in the popup HTML', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [
      makeQuake({
        offshore: true,
        felt: 312,
        news_link: 'https://example.com/article',
        news_title: 'Strong quake felt across the region',
      }),
    ];
    document.body.appendChild(el);
    await waitForMap(el);

    const popupCall = maplibreMock.Popup.mock.results.at(-1);
    const html = popupCall?.value.html as string;
    expect(html).toContain('Offshore');
    expect(html).toContain('Felt by 312');
    expect(html).toContain('href="https://example.com/article"');
    expect(html).toContain('Strong quake felt across the region');
  });

  it('does not link an unsafe news_link scheme into the popup', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake({ news_link: 'javascript:alert(1)', news_title: 'evil' })];
    document.body.appendChild(el);
    await waitForMap(el);

    const popupCall = maplibreMock.Popup.mock.results.at(-1);
    const html = popupCall?.value.html as string;
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a ');
  });
});
