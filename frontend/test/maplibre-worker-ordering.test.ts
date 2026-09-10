import { describe, it, expect, vi } from 'vitest';
import { EarthquakeListMap } from '../src/components/map';
import { EarthquakeListItem, HomeAssistant } from '../src/types';

// Its own file, not part of map.test.ts: the assertion below is about the very first worker URL
// and the very first map ever constructed, so it needs a module registry nothing else has touched.
//
// `maplibre-gl` is module-mocked for the same reason as in map.test.ts — `connectedCallback` fires
// a real `import('maplibre-gl')` on mount, and the real module wants a WebGL context jsdom has not
// got.
const { maplibreMock, mapConstructor, setWorkerUrl } = vi.hoisted(() => {
  const mapInstanceMock = {
    addControl: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getContainer: vi.fn(() => document.createElement('div')),
    resize: vi.fn(),
    remove: vi.fn(),
    fitBounds: vi.fn(),
    jumpTo: vi.fn(),
    getZoom: vi.fn(() => 10),
  };

  const mapConstructor = vi.fn().mockImplementation(function (options: { container: HTMLElement }) {
    mapInstanceMock.addControl = vi.fn((control: { onAdd: () => HTMLElement }) => {
      options.container.appendChild(control.onAdd());
    });
    return mapInstanceMock;
  });
  const setWorkerUrl = vi.fn();

  return {
    mapConstructor,
    setWorkerUrl,
    maplibreMock: {
      Map: mapConstructor,
      Marker: vi.fn().mockImplementation(function (options: { element?: HTMLElement }) {
        const element = options?.element ?? document.createElement('div');
        const marker = {
          setLngLat: vi.fn(() => marker),
          getLngLat: vi.fn(() => undefined),
          setPopup: vi.fn(() => marker),
          addTo: vi.fn(() => marker),
          remove: vi.fn(() => marker),
          getElement: vi.fn(() => element),
        };
        return marker;
      }),
      Popup: vi.fn().mockImplementation(function () {
        const popup = { setHTML: vi.fn(() => popup) };
        return popup;
      }),
      NavigationControl: vi.fn().mockImplementation(function () {
        return { onAdd: () => document.createElement('div') };
      }),
      AttributionControl: vi.fn().mockImplementation(function () {
        return { onAdd: () => document.createElement('div') };
      }),
      LngLatBounds: class {
        extend() {
          return this;
        }
        isEmpty() {
          return true;
        }
        getNorthEast() {
          return { lng: 0, lat: 0 };
        }
        getSouthWest() {
          return { lng: 0, lat: 0 };
        }
      },
      setWorkerUrl,
    },
  };
});

vi.mock('maplibre-gl', () => maplibreMock);

function makeHass(): HomeAssistant {
  return {
    states: {},
    entities: {},
    devices: {},
    localize: (key: string) => key,
    language: 'en',
    locale: { language: 'en', number_format: 'comma_decimal', time_format: '24' },
    callWS: async () => ({}) as never,
    config: { components: [] },
  } as unknown as HomeAssistant;
}

const quake: EarthquakeListItem = {
  id: 'quake-1',
  magnitude: 4.2,
  latitude: 40.0,
  longitude: 19.8,
  place: 'Corfu',
  time: '2026-06-12T04:42:08+00:00',
};

describe('the MapLibre worker URL in a mounted map', () => {
  // MapLibre reads WORKER_URL when it spins up its worker pool, which happens inside the Map
  // constructor. Setting it afterwards is as good as not setting it: no worker, no vector tile
  // parsing, and a map that stays empty without raising anything.
  it('is set once, before the first map is constructed, for any number of maps', async () => {
    // Mounted one after the other, not all at once: two `import('maplibre-gl')` calls in flight at
    // the same time race vitest's module mock, and the loser gets the real MapLibre, which then
    // dies on jsdom's missing WebGL2 context.
    for (let i = 1; i <= 3; i++) {
      const el = new EarthquakeListMap();
      el.hass = makeHass();
      el.earthquakes = [quake];
      document.body.appendChild(el);
      await vi.waitFor(() => {
        expect(mapConstructor.mock.calls.length).toBeGreaterThanOrEqual(i);
      });
    }

    expect(setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(setWorkerUrl.mock.invocationCallOrder[0]).toBeLessThan(mapConstructor.mock.invocationCallOrder[0]);

    document.body.innerHTML = '';
  });
});
