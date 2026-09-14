import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EarthquakeListMap } from '../src/components/map';
import { EarthquakeListItem, HomeAssistant } from '../src/types';

function makeHass(overrides: Partial<HomeAssistant> = {}): HomeAssistant {
  return {
    states: {},
    entities: {},
    devices: {},
    localize: (key: string) => key,
    language: 'en',
    locale: { language: 'en', number_format: 'comma_decimal', time_format: '24' },
    callWS: async () => ({}) as never,
    config: { components: ['sun'] },
    ...overrides,
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

  const makeHandlerMock = () => ({ enable: vi.fn(), disable: vi.fn() });

  const mapContainerMock = document.createElement('div');
  const mapInstanceMock = {
    addControl: vi.fn(),
    on: vi.fn(),
    getContainer: vi.fn(() => mapContainerMock),
    dragPan: makeHandlerMock(),
    scrollZoom: makeHandlerMock(),
    doubleClickZoom: makeHandlerMock(),
    touchZoomRotate: makeHandlerMock(),
    touchPitch: makeHandlerMock(),
    dragRotate: makeHandlerMock(),
    boxZoom: makeHandlerMock(),
    keyboard: makeHandlerMock(),
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
    // map.ts points MapLibre at the bundled worker before constructing a map; without this the
    // call throws and every map init fails, quietly, inside _initMap's catch.
    setWorkerUrl: vi.fn(),
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
    // One container is shared by every map the mock hands out, so classes would leak between tests.
    mapInstanceMock.getContainer().className = '';
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

  it('keeps auto-zoom on for programmatic camera moves but disables it for real interaction', async () => {
    const el = new EarthquakeListMap();
    el.hass = makeHass();
    el.earthquakes = [makeQuake()];
    document.body.appendChild(el);
    await waitForMap(el);

    const handlerFor = (evt: string) =>
      mapInstanceMock.on.mock.calls.find(([name]) => name === evt)?.[1] as (e?: unknown) => void;
    const state = () => (el as unknown as { _userInteractedWithMap: boolean })._userInteractedWithMap;

    // A resize makes MapLibre emit movestart with no `originalEvent`. This used to switch
    // auto-zoom off, which then left the view un-refitted for the new size.
    handlerFor('movestart')?.({});
    handlerFor('zoomstart')?.(undefined);
    expect(state()).toBe(false);

    // A drag/wheel/touch carries `originalEvent` and must disable auto-zoom.
    handlerFor('movestart')?.({ originalEvent: new MouseEvent('mousedown') });
    expect(state()).toBe(true);
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

  describe('interaction lock', () => {
    const lockButton = (el: EarthquakeListMap) => el.shadowRoot?.querySelector('a.lock-button') as HTMLAnchorElement;

    it('leaves the map interactive by default', async () => {
      const el = new EarthquakeListMap();
      el.hass = makeHass();
      el.earthquakes = [makeQuake()];
      document.body.appendChild(el);
      await waitForMap(el);

      expect(mapInstanceMock.dragPan.disable).not.toHaveBeenCalled();
      expect(mapInstanceMock.dragPan.enable).toHaveBeenCalled();
      expect(lockButton(el).getAttribute('aria-pressed')).toBe('false');
      expect(lockButton(el).getAttribute('aria-label')).toBe('Disable map interaction');
    });

    it('disables every camera handler when the card is configured locked', async () => {
      const el = new EarthquakeListMap();
      el.hass = makeHass();
      el.earthquakes = [makeQuake()];
      el.locked = true;
      document.body.appendChild(el);
      await waitForMap(el);

      expect(mapInstanceMock.dragPan.disable).toHaveBeenCalled();
      expect(mapInstanceMock.scrollZoom.disable).toHaveBeenCalled();
      expect(mapInstanceMock.touchZoomRotate.disable).toHaveBeenCalled();
      expect(mapInstanceMock.keyboard.disable).toHaveBeenCalled();
      expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(true);
      expect(lockButton(el).getAttribute('aria-pressed')).toBe('true');
      expect(lockButton(el).getAttribute('aria-label')).toBe('Enable map interaction');
    });

    it('re-enables interaction when the lock button is clicked', async () => {
      const el = new EarthquakeListMap();
      el.hass = makeHass();
      el.earthquakes = [makeQuake()];
      el.locked = true;
      document.body.appendChild(el);
      await waitForMap(el);

      mapInstanceMock.dragPan.enable.mockClear();
      lockButton(el).click();

      expect(mapInstanceMock.dragPan.enable).toHaveBeenCalled();
      expect(mapInstanceMock.getContainer().classList.contains('map-locked')).toBe(false);
      expect(lockButton(el).getAttribute('aria-pressed')).toBe('false');
    });

    it('localizes the lock control instead of hardcoding English', async () => {
      const el = new EarthquakeListMap();
      el.hass = { ...makeHass(), language: 'de' } as HomeAssistant;
      el.earthquakes = [makeQuake()];
      document.body.appendChild(el);
      await waitForMap(el);

      expect(lockButton(el).getAttribute('aria-label')).toBe('Karteninteraktion deaktivieren');
    });
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
    // The headline is the tooltip, not the link text — it would wrap to several lines here.
    expect(html).toContain('title="Strong quake felt across the region"');
    expect(html).toContain('>Read more<');
    // Blocks, not <br>-joined lines, so the chip row doesn't get blank lines around it.
    expect(html).not.toContain('<br>');
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

  // Every dashboard render used to send a bounding box around the user's home straight to
  // OpenFreeMap. HA 2026.9's `map_tiles` integration proxies OSM tiles through the user's own
  // instance instead — but nothing pins a minimum HA version, so the OpenFreeMap path is a
  // regular fallback, not a dead branch. Mirrors the sibling blitzortung card's suite.
  describe('base map tiles', () => {
    const OPENFREEMAP = 'https://tiles.openfreemap.org/styles/';

    // Home Assistant's own style, shaped as HA 2026.9.1 serves it: every URL in it is an
    // instance-relative path, which is exactly what MapLibre refuses to load. `name` carries
    // the requested style URL so the theme tests can tell the two styles apart.
    const haStyle = (styleUrl: string) => ({
      version: 8,
      name: styleUrl,
      glyphs: '/api/map_tiles/fonts/{fontstack}/{range}.pbf',
      sprite: [{ id: 'basics', url: '/api/map_tiles/sprites/basics/sprites' }],
      sources: {
        'versatiles-shortbread': { type: 'vector', url: '/api/map_tiles/tilejson.json' },
        'third-party': { type: 'raster', tiles: ['https://example.invalid/{z}/{x}/{y}.png'] },
      },
      layers: [],
    });

    let fetchMock: ReturnType<typeof vi.fn>;
    const stubStyleFetch = (impl: (url: string) => Promise<unknown>) => {
      fetchMock = vi.fn((url: unknown) => impl(String(url)));
      vi.stubGlobal('fetch', fetchMock);
    };

    beforeEach(() => {
      stubStyleFetch(async (url) => ({ ok: true, status: 200, json: async () => haStyle(url) }));
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const coreTilesHass = (overrides: Partial<HomeAssistant> = {}): HomeAssistant =>
      makeHass({
        config: { components: ['sun', 'map_tiles'] },
        callWS: vi.fn().mockResolvedValue({ token: 'a'.repeat(64) }),
        ...overrides,
      });

    const mount = async (
      hass: HomeAssistant,
      tileSource?: 'auto' | 'core' | 'openfreemap',
      themeMode?: 'auto' | 'light' | 'dark',
    ) => {
      const el = new EarthquakeListMap();
      el.hass = hass;
      if (tileSource) el.tileSource = tileSource;
      if (themeMode) el.themeMode = themeMode;
      el.earthquakes = [makeQuake()];
      document.body.appendChild(el);
      await waitForMap(el);
      return el;
    };

    const lastMapOptions = () =>
      maplibreMock.Map.mock.calls.at(-1)![0] as unknown as {
        style: string | { sources: Record<string, Record<string, unknown>> };
        transformRequest?: (url: string) => { url: string };
      };

    it('serves tiles through the Home Assistant proxy when map_tiles is loaded', async () => {
      const hass = coreTilesHass();
      await mount(hass);

      expect(hass.callWS).toHaveBeenCalledWith({ type: 'map_tiles/access_token' });
      expect(fetchMock).toHaveBeenCalledWith('/static/map/light.json');

      const style = lastMapOptions().style as unknown as {
        glyphs: string;
        sprite: { id: string; url: string }[];
        sources: Record<string, { url?: string; tiles?: string[] }>;
      };
      expect(typeof style).toBe('object');

      // Every instance-relative URL has to come out absolute. MapLibre rejects a relative
      // sprite URL outright, and a relative tile URL cannot be resolved inside the Blob-URL
      // worker that parses vector tiles.
      const origin = window.location.origin;
      expect(style.glyphs).toBe(`${origin}/api/map_tiles/fonts/{fontstack}/{range}.pbf`);
      expect(style.sprite[0]!.url).toBe(`${origin}/api/map_tiles/sprites/basics/sprites`);
      expect(style.sources['versatiles-shortbread']!.url).toBe(`${origin}/api/map_tiles/tilejson.json`);
      // A third-party URL is already resolvable and must not be rewritten.
      expect(style.sources['third-party']!.tiles).toEqual(['https://example.invalid/{z}/{x}/{y}.png']);
    });

    it('falls back to OpenFreeMap when the style cannot be fetched', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        stubStyleFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
        await mount(coreTilesHass());
        expect(lastMapOptions().style).toContain(OPENFREEMAP);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('falls back to OpenFreeMap when map_tiles is not loaded', async () => {
      const hass = makeHass({ callWS: vi.fn() });
      await mount(hass);
      expect(lastMapOptions().style).toContain(OPENFREEMAP);
      expect(hass.callWS).not.toHaveBeenCalled();
    });

    it('falls back to OpenFreeMap when the token request fails, and warns only once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const el = await mount(coreTilesHass({ callWS: vi.fn().mockRejectedValue(new Error('unknown command')) }));
        expect(lastMapOptions().style).toContain(OPENFREEMAP);
        expect(warn).toHaveBeenCalledTimes(1);

        // A remount re-runs the whole init; the warning must not repeat per render.
        el.remove();
        document.body.appendChild(el);
        await waitForMap(el);
        expect(lastMapOptions().style).toContain(OPENFREEMAP);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('authenticates tile requests by query parameter, the only method the proxy accepts', async () => {
      await mount(coreTilesHass());
      const transformRequest = lastMapOptions().transformRequest!;

      const token = 'a'.repeat(64);
      const origin = window.location.origin;

      expect(transformRequest('http://ha.local/api/map_tiles/vector/3/4/2.mvt').url).toBe(
        `http://ha.local/api/map_tiles/vector/3/4/2.mvt?token=${token}`,
      );

      // Regression: the proxy's TileJSON hands MapLibre root-relative tile templates, and
      // MapLibre passes tile URLs to the Web Worker — which this card builds from a Blob URL,
      // a cannot-be-a-base URL. A relative URL cannot be resolved against it, so every tile
      // failed with `Failed to construct 'Request'` and the map stayed blank. Absolutising has
      // to happen here, the last point on the main thread before the URL crosses over.
      expect(transformRequest('/api/map_tiles/vector/3/4/2.mvt').url).toBe(
        `${origin}/api/map_tiles/vector/3/4/2.mvt?token=${token}`,
      );
      expect(transformRequest('/local/whatever.png')).toEqual({ url: `${origin}/local/whatever.png` });

      // Anything that is not a proxy request is handed back untouched.
      expect(transformRequest('https://tiles.openfreemap.org/styles/positron')).toEqual({
        url: 'https://tiles.openfreemap.org/styles/positron',
      });

      // It is the path that has to match: a third-party URL merely mentioning the proxy in its
      // query must not be handed this instance's token.
      expect(transformRequest('https://example.invalid/x?next=/api/map_tiles/')).toEqual({
        url: 'https://example.invalid/x?next=/api/map_tiles/',
      });
    });

    it('renews the token well inside its 30-minute rotation and clears the timer on disconnect', async () => {
      const setInterval = vi.spyOn(window, 'setInterval');
      const clearInterval = vi.spyOn(window, 'clearInterval');
      try {
        const hass = coreTilesHass();
        const el = await mount(hass);

        const [renew, delay] = setInterval.mock.calls.at(-1)! as unknown as [() => void, number];
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThan(30 * 60 * 1000);

        renew();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(hass.callWS).toHaveBeenCalledTimes(2);

        const timerId = (el as unknown as { _coreTilesTokenTimer?: number })._coreTilesTokenTimer;
        expect(timerId).not.toBeUndefined();

        el.remove();
        expect(clearInterval).toHaveBeenCalledWith(timerId);
        expect((el as unknown as { _coreTilesTokenTimer?: number })._coreTilesTokenTimer).toBeUndefined();
      } finally {
        setInterval.mockRestore();
        clearInterval.mockRestore();
      }
    });

    it('forces OpenFreeMap when tileSource is openfreemap, proxy or not', async () => {
      const hass = coreTilesHass();
      await mount(hass, 'openfreemap');
      expect(lastMapOptions().style).toContain(OPENFREEMAP);
      expect(hass.callWS).not.toHaveBeenCalled();
    });

    it('forces the proxy when tileSource is core, even if map_tiles is not listed', async () => {
      await mount(makeHass({ callWS: vi.fn().mockResolvedValue({ token: 'b'.repeat(64) }) }), 'core');
      expect(typeof lastMapOptions().style).toBe('object');
    });

    // `map_theme_mode` pins the map's look for dashboards that stay on one; `auto` keeps
    // following Home Assistant. The style is chosen at construction, so each of these is a
    // separate map rather than a restyle of a live one.
    it('lets map_theme_mode override Home Assistant, and follows it on auto', async () => {
      const dunkleHass = () => coreTilesHass({ themes: { darkMode: true } });
      const helleHass = () => coreTilesHass({ themes: { darkMode: false } });
      const stil = () => (lastMapOptions().style as unknown as { name: string }).name;

      // light wins over a dark Home Assistant, dark wins over a light one.
      await mount(dunkleHass(), undefined, 'light');
      expect(stil()).toBe('/static/map/light.json');
      await mount(helleHass(), undefined, 'dark');
      expect(stil()).toBe('/static/map/dark.json');

      // auto defers to Home Assistant in both directions.
      await mount(dunkleHass(), undefined, 'auto');
      expect(stil()).toBe('/static/map/dark.json');
      await mount(helleHass(), undefined, 'auto');
      expect(stil()).toBe('/static/map/light.json');
    });

    // On `auto` the trigger is a new `hass`, not a changed property of the component's own, so
    // a theme toggle would otherwise leave a dark dashboard showing the light map until reload.
    it('rebuilds the map when Home Assistant switches theme under it', async () => {
      const el = await mount(coreTilesHass({ themes: { darkMode: false } }), undefined, 'auto');
      expect((lastMapOptions().style as unknown as { name: string }).name).toBe('/static/map/light.json');
      const vorher = maplibreMock.Map.mock.calls.length;

      el.hass = coreTilesHass({ themes: { darkMode: true } });
      await waitForMap(el);
      expect(maplibreMock.Map.mock.calls.length).toBeGreaterThan(vorher);
      expect((lastMapOptions().style as unknown as { name: string }).name).toBe('/static/map/dark.json');

      // A `hass` update that leaves the theme alone must not throw the map away.
      const stabil = maplibreMock.Map.mock.calls.length;
      el.hass = coreTilesHass({ themes: { darkMode: true } });
      await el.updateComplete;
      expect(maplibreMock.Map.mock.calls.length).toBe(stabil);
    });

    // Dark mode used to be a CSS filter over the canvas, because the proxied raster came in
    // light only. A real dark style replaces it — the map is restyled rather than recoloured.
    it('loads the dark style in dark mode and the light one otherwise', async () => {
      await mount(coreTilesHass({ themes: { darkMode: true } }));
      expect(fetchMock).toHaveBeenCalledWith('/static/map/dark.json');
      expect((lastMapOptions().style as unknown as { name: string }).name).toBe('/static/map/dark.json');

      await mount(coreTilesHass({ themes: { darkMode: false } }));
      expect(fetchMock).toHaveBeenCalledWith('/static/map/light.json');
      expect((lastMapOptions().style as unknown as { name: string }).name).toBe('/static/map/light.json');

      // OpenFreeMap ships its own pair of styles and never goes through the proxy.
      await mount(makeHass({ themes: { darkMode: true } }));
      expect(lastMapOptions().style).toBe('https://tiles.openfreemap.org/styles/dark');
    });
  });
});
