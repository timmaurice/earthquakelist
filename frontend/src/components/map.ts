import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type {
  Map as MapLibreMap,
  Marker,
  LngLatBounds,
  IControl,
  StyleSpecification,
  RequestParameters,
} from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import mapStyles from '../styles/map-styles.scss';
import { EarthquakeListItem, HomeAssistant, MapTileSource } from '../types';
import { isSafeUrl, magnitudeSeverity } from '../utils';
import { localize } from '../localize';
import { installMapLibreWorker } from '../maplibre-worker';

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OPENFREEMAP_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// ─── Home Assistant's own tile proxy (`map_tiles`, HA 2026.9+) ────────────────────────────
// Requesting the base map straight from OpenFreeMap means every dashboard render sends a
// bounding box around the user's home to a third party, with no way to turn it off.
// `map_tiles` proxies OpenStreetMap through the user's own instance instead.
//
// Its *raster* endpoint is what we use, not the vector one. The integration ships no
// ready-made MapLibre style (`/api/map_tiles/style.json` is a 404), so a vector map would
// mean authoring a complete base map — water, landuse, roads, labels — against glyphs named
// `noto_sans_regular` rather than the conventional `Noto Sans Regular` (the conventional
// spelling 502s), and with no sprites at all (`sprites/default/sprite.json` is a 404). That
// is a project of its own. Kept deliberately identical to the sibling
// `lovelace-blitzortung-lightning-card`, whose map component this one shares its shape with.
const CORE_TILES_COMPONENT = 'map_tiles';
const CORE_TILES_PATH = '/api/map_tiles/raster/{z}/{x}/{y}.png';
const CORE_TILES_SOURCE_ID = 'ha-map-tiles';
// The source's own ceiling, as declared by `/api/map_tiles/tilejson.json`. MapLibre still
// zooms past it by scaling the z14 tile; declaring it is what stops the map from requesting
// tiles that do not exist.
const CORE_TILES_MAX_ZOOM = 14;
// Also from that TileJSON. OpenStreetMap requires it to be displayed, and handing it to the
// source is what puts it in the AttributionControl the map already has.
const CORE_TILES_ATTRIBUTION = '© OpenStreetMap contributors';
// Tokens rotate every 30 minutes, with the previous one staying valid. Renewing well inside
// that window means a tile request is never made with an expired token.
const CORE_TILES_TOKEN_REFRESH_MS = 10 * 60 * 1000;

// A minimal single-layer raster style. Token-free by design: the token rotates, so it is
// appended per request in `_transformRequest` instead of being baked into the tile template.
function buildCoreTilesStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      [CORE_TILES_SOURCE_ID]: {
        type: 'raster',
        tiles: [CORE_TILES_PATH],
        tileSize: 256,
        minzoom: 0,
        maxzoom: CORE_TILES_MAX_ZOOM,
        attribution: CORE_TILES_ATTRIBUTION,
      },
    },
    layers: [{ id: CORE_TILES_SOURCE_ID, type: 'raster', source: CORE_TILES_SOURCE_ID }],
  };
}

// Re-enables auto-zoom after the user manually pans/zooms.
class RecenterControl implements IControl {
  private _container: HTMLElement | undefined;
  private _link: HTMLAnchorElement | undefined;

  constructor(
    private readonly onClick: () => void,
    private readonly ariaLabel: string,
  ) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const link = document.createElement('a');
    link.className = 'recenter-button';
    link.href = '#';
    link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', this.ariaLabel);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });

    container.appendChild(link);
    this._container = container;
    this._link = link;
    return container;
  }

  onRemove(): void {
    this._container?.remove();
  }

  getLink(): HTMLAnchorElement | undefined {
    return this._link;
  }
}

export class EarthquakeListMap extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public earthquakes: EarthquakeListItem[] = [];
  @property({ attribute: false }) public tileSource: MapTileSource = 'auto';

  private _map: MapLibreMap | undefined = undefined;
  private _quakeMarkers: Map<string, Marker> = new Map();
  private _maplibregl: typeof import('maplibre-gl') | undefined;
  private _resizeObserver: ResizeObserver | null = null;
  private _isInitializingMap = false;
  private _userInteractedWithMap = false;
  private _recenterButton: HTMLAnchorElement | undefined;
  private _programmaticMapChange = false;
  private _programmaticChangeSettleTimer: number | undefined;
  private _hasAutoZoomedOnce = false;
  private _coreTilesToken: string | null = null;
  private _coreTilesTokenTimer: number | undefined;
  private _coreTilesWarned = false;

  connectedCallback(): void {
    super.connectedCallback();
    this._initMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyMap();
  }

  protected updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    if (!this._map) {
      this._initMap();
      return;
    }
    if (changedProperties.has('tileSource')) {
      // The tile source is baked into the style at construction, so it takes a new map.
      this._destroyMap();
      this._initMap();
      return;
    }
    if (changedProperties.has('earthquakes')) {
      this._updateMapMarkers();
    }
  }

  private _coreTilesInstalled(): boolean {
    return this.hass?.config?.components?.includes(CORE_TILES_COMPONENT) === true;
  }

  /**
   * Decides which base map this init will use, fetching a first token for the core proxy.
   * Returns false to mean "fall back to OpenFreeMap": either the user asked for it, or
   * `map_tiles` is not there, or the token could not be fetched. Renewal is started by the
   * caller, after it has re-checked that the component is still connected — starting it here
   * would leak an interval when the card is detached while this await is in flight.
   */
  private async _useCoreTiles(): Promise<boolean> {
    if (this.tileSource === 'openfreemap') {
      return false;
    }
    // `core` is a deliberate override, so it still tries when the component is not listed —
    // a failed token fetch below is what turns that into a fallback.
    if (this.tileSource === 'auto' && !this._coreTilesInstalled()) {
      return false;
    }
    return (await this._fetchCoreTilesToken()) !== null;
  }

  // A failed token fetch is a fallback, not a crash — and it warns once per component rather
  // than on every render, so a permanently unavailable proxy cannot flood the console.
  private async _fetchCoreTilesToken(): Promise<string | null> {
    try {
      const response = await this.hass.callWS<{ token?: string }>({ type: 'map_tiles/access_token' });
      if (!response?.token) {
        throw new Error('map_tiles/access_token returned no token');
      }
      this._coreTilesToken = response.token;
      return response.token;
    } catch (err) {
      this._coreTilesToken = null;
      if (!this._coreTilesWarned) {
        this._coreTilesWarned = true;
        console.warn('[EarthquakeList Map] Could not get a map_tiles token; using OpenFreeMap tiles instead.', err);
      }
      return null;
    }
  }

  private _startCoreTilesTokenRefresh(): void {
    this._stopCoreTilesTokenRefresh();
    this._coreTilesTokenTimer = window.setInterval(() => {
      void this._fetchCoreTilesToken();
    }, CORE_TILES_TOKEN_REFRESH_MS);
  }

  private _stopCoreTilesTokenRefresh(): void {
    if (this._coreTilesTokenTimer !== undefined) {
      window.clearInterval(this._coreTilesTokenTimer);
      this._coreTilesTokenTimer = undefined;
    }
  }

  // The proxy authenticates by query parameter only — an `Authorization: Bearer` header is
  // rejected with 401 — and MapLibre gives no other hook for per-request credentials.
  // Reading the token here (rather than baking it into the tile template) means a renewal
  // takes effect on the next tile request without touching the style.
  private _transformRequest = (url: string): RequestParameters => {
    if (this._coreTilesToken && url.includes('/api/map_tiles/')) {
      const separator = url.includes('?') ? '&' : '?';
      return { url: `${url}${separator}token=${encodeURIComponent(this._coreTilesToken)}` };
    }
    return { url };
  };

  private async _getMapLibre() {
    if (!this._maplibregl) {
      // maplibre-gl v6 loads its Web Worker from a file next to maplibre-gl.mjs — in v5 the
      // worker was a string inside the main bundle. A HACS card is a single file, so that
      // request 404s, and MapLibre then cannot parse vector tiles and gives no sign of it: the
      // style comes back with no sources and no layers, isStyleLoaded() stays false, no tile
      // request is made and nothing throws. `installMapLibreWorker` supplies the worker from a
      // blob built out of the bundled source; it must run before the first
      // `new maplibregl.Map(...)`.
      const maplibregl = await import('maplibre-gl');
      installMapLibreWorker(maplibregl);
      this._maplibregl = maplibregl;
    }
    return this._maplibregl!;
  }

  private _markerKey(eq: EarthquakeListItem): string {
    return eq.id ?? `${eq.latitude},${eq.longitude},${eq.time}`;
  }

  private _escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private _formatPopupTime(eq: EarthquakeListItem): string {
    if (!eq.time) return '';
    const date = new Date(eq.time);
    if (eq.local_timezone) {
      try {
        const local = date.toLocaleString(this.hass?.language, { timeZone: eq.local_timezone });
        return eq.local_timezone_short
          ? localize(this.hass, 'card.local_time', { time: local, zone: this._escapeHtml(eq.local_timezone_short) })
          : local;
      } catch {
        // invalid timezone name — fall through to the viewer's own timezone below
      }
    }
    return date.toLocaleString(this.hass?.language);
  }

  private _popupChip(icon: string, value: string, tooltip: string): string {
    return `<span class="popup-chip" title="${this._escapeHtml(tooltip)}"><ha-icon icon="${icon}"></ha-icon>${this._escapeHtml(value)}</span>`;
  }

  // Blocks, not `<br>`-joined lines: a block-level element between two `<br>` renders an
  // extra blank line on each side, which left a large gap around the chip row.
  private _buildPopupHtml(eq: EarthquakeListItem): string {
    const time = this._formatPopupTime(eq);
    const place = this._escapeHtml(eq.place ?? eq.location ?? '');
    const blocks = [`<div class="popup-title"><strong>M${eq.magnitude?.toFixed(1) ?? '?'}</strong> ${place}</div>`];
    if (time) blocks.push(`<div class="popup-time">${this._escapeHtml(time)}</div>`);

    const chips: string[] = [];
    if (eq.distance_km !== undefined) {
      const distance = `${Math.round(eq.distance_km)} km ${eq.direction ?? ''}`.trim();
      chips.push(this._popupChip('mdi:map-marker-distance', distance, localize(this.hass, 'card.distance')));
    }
    if (eq.depth_km !== undefined) {
      chips.push(
        this._popupChip('mdi:arrow-expand-down', `${Math.round(eq.depth_km)} km`, localize(this.hass, 'card.depth')),
      );
    }
    if (eq.offshore) {
      chips.push(this._popupChip('mdi:waves', '', localize(this.hass, 'card.offshore')));
    }
    if (eq.felt !== undefined && eq.felt > 0) {
      chips.push(
        this._popupChip(
          'mdi:account-voice',
          String(eq.felt),
          localize(this.hass, 'card.felt_reports', { count: eq.felt }),
        ),
      );
    }
    if (chips.length) blocks.push(`<div class="popup-chips">${chips.join('')}</div>`);

    if (isSafeUrl(eq.news_link)) {
      const href = this._escapeHtml(eq.news_link);
      // The headline goes in the tooltip, not the link text: in a popup this narrow a real
      // headline wraps to three lines and dominates everything else.
      const title = eq.news_title ? ` title="${this._escapeHtml(eq.news_title)}"` : '';
      const label = this._escapeHtml(localize(this.hass, 'card.read_more'));
      blocks.push(
        `<a class="popup-news" href="${href}" target="_blank" rel="noopener noreferrer"${title}>` +
          `<ha-icon icon="mdi:newspaper-variant-outline"></ha-icon>${label}</a>`,
      );
    }
    return blocks.join('');
  }

  // `compact: true` alone doesn't start the attribution collapsed: MapLibre populates it
  // asynchronously (styledata), and that first population is what adds `maplibregl-compact`
  // *and* `-compact-show`. So collapse once it actually has content, not at init.
  private _collapseAttributionOnce(mapContainer: HTMLElement): void {
    if (!this._map) return;
    const collapse = () => {
      const attrib = mapContainer.querySelector('.maplibregl-ctrl-attrib');
      if (!attrib || attrib.classList.contains('maplibregl-attrib-empty')) return;
      attrib.classList.remove('maplibregl-compact-show');
      attrib.removeAttribute('open');
      this._map?.off('styledata', collapse);
      this._map?.off('sourcedata', collapse);
    };
    this._map.on('styledata', collapse);
    this._map.on('sourcedata', collapse);
  }

  // Suppresses the interaction listeners below for our own camera moves (fitBounds/jumpTo/resize).
  private _beginProgrammaticMapChange(): void {
    if (!this._map) return;
    this._programmaticMapChange = true;
    this._map.getContainer().classList.add('interaction-disabled');
    this._scheduleProgrammaticMapChangeClear();
  }

  private _scheduleProgrammaticMapChangeClear(): void {
    if (this._programmaticChangeSettleTimer) {
      window.clearTimeout(this._programmaticChangeSettleTimer);
    }
    this._programmaticChangeSettleTimer = window.setTimeout(() => {
      this._programmaticChangeSettleTimer = undefined;
      this._programmaticMapChange = false;
      this._map?.getContainer().classList.remove('interaction-disabled');
    }, 150);
  }

  private _handleMapMoveEnd = (): void => {
    if (this._programmaticMapChange) {
      this._scheduleProgrammaticMapChangeClear();
    }
  };

  private async _initMap(): Promise<void> {
    const mapContainer = this.shadowRoot?.querySelector('#map-container');
    if (
      !this.isConnected ||
      !mapContainer ||
      !(mapContainer instanceof HTMLElement) ||
      this._map ||
      this._isInitializingMap
    ) {
      return;
    }
    this._isInitializingMap = true;

    try {
      const maplibregl = await this._getMapLibre();
      if (!this.isConnected || this._map) return;

      const currentContainer = this.shadowRoot?.querySelector('#map-container');
      if (!currentContainer || currentContainer !== mapContainer) return;

      const darkMode = this.hass?.themes?.darkMode ?? false;

      const useCoreTiles = await this._useCoreTiles();
      if (!this.isConnected || this._map) return;
      if (useCoreTiles) {
        this._startCoreTilesTokenRefresh();
      }

      // OpenFreeMap ships a dark style; the proxied OSM raster only comes in light, so dark
      // mode is a CSS filter over the canvas — the same trick Home Assistant's own map uses.
      const style: StyleSpecification | string = useCoreTiles
        ? buildCoreTilesStyle()
        : darkMode
          ? OPENFREEMAP_DARK_STYLE
          : OPENFREEMAP_LIGHT_STYLE;
      mapContainer.classList.toggle('inverted-tiles', useCoreTiles && darkMode);

      this._map = new maplibregl.Map({
        container: mapContainer,
        style,
        center: [0, 0],
        zoom: 0,
        attributionControl: false,
        transformRequest: this._transformRequest,
      });

      this._map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this._collapseAttributionOnce(mapContainer);
      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

      // MapLibre sets `originalEvent` only for camera changes a person actually caused
      // (drag, wheel, touch, keyboard), which is a far more reliable signal than the timing
      // guard: a single window resize fires move events after the guard's window has elapsed,
      // which silently switched auto-zoom off — and the view was then never re-fitted for the
      // new size, leaving markers clipped outside the map. The guard still applies
      // `interaction-disabled` (pointer-events: none) during our own camera moves, so a real
      // drag cannot reach the map while one is running anyway.
      const markUserInteracted = (event?: { originalEvent?: unknown }) => {
        if (!event?.originalEvent) return;
        this._userInteractedWithMap = true;
        this._updateRecenterButtonState();
      };
      this._map.on('zoomstart', markUserInteracted);
      this._map.on('movestart', markUserInteracted);
      this._map.on('dragstart', markUserInteracted);
      this._map.on('moveend', this._handleMapMoveEnd);

      const recenterControl = new RecenterControl(
        () => {
          this._userInteractedWithMap = false;
          this._updateMapMarkers();
          this._updateRecenterButtonState();
        },
        localize(this.hass, 'card.recenter_map'),
      );
      this._map.addControl(recenterControl, 'top-left');
      this._recenterButton = recenterControl.getLink();

      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => {
          if (!this._map) return;
          this._beginProgrammaticMapChange();
          this._map.resize();
          // A fit computed for the old size no longer holds once the card changes width, so
          // re-fit while auto-zoom is still on — otherwise markers end up outside the map.
          if (!this._userInteractedWithMap) this._updateMapMarkers();
        });
        this._resizeObserver.observe(mapContainer);
      }

      this._beginProgrammaticMapChange();
      this._map.resize();
      this._updateMapMarkers();
      this._updateRecenterButtonState();
    } catch (err) {
      console.error('[EarthquakeList Map] Failed to initialize map:', err);
    } finally {
      this._isInitializingMap = false;
    }
  }

  private async _updateMapMarkers(): Promise<void> {
    if (!this._map) return;
    const maplibregl = await this._getMapLibre();
    if (!this._map || !this.isConnected) return;

    const bounds = new maplibregl.LngLatBounds();
    const seenKeys = new Set<string>();

    this.earthquakes.forEach((eq, index) => {
      if (eq.latitude === undefined || eq.longitude === undefined) return;
      const key = this._markerKey(eq);
      seenKeys.add(key);
      bounds.extend([eq.longitude, eq.latitude]);

      const severity = magnitudeSeverity(eq.magnitude);
      const size = 18 + Math.round((eq.magnitude ?? 3) * 2);
      const isLatest = index === 0;
      // Rank newer quakes above older ones so the latest marker's pulse never paints under another.
      const zIndex = this.earthquakes.length - index + (isLatest ? 1000 : 0);

      if (!this._quakeMarkers.has(key)) {
        const wrapper = document.createElement('div');
        wrapper.className = `eq-marker-wrapper${isLatest ? ' latest' : ''}`;
        wrapper.style.zIndex = String(zIndex);
        wrapper.innerHTML = `<div class="eq-marker ${severity}" style="width:${size}px;height:${size}px;">${
          eq.magnitude !== undefined ? eq.magnitude.toFixed(1) : ''
        }</div>`;

        const darkMode = this.hass?.themes?.darkMode ?? false;
        const popup = new maplibregl.Popup({
          offset: size / 2 + 4,
          className: darkMode ? 'eq-popup-dark' : 'eq-popup-light',
        }).setHTML(this._buildPopupHtml(eq));

        const marker = new maplibregl.Marker({ element: wrapper })
          .setLngLat([eq.longitude, eq.latitude])
          .setPopup(popup)
          .addTo(this._map!);
        this._quakeMarkers.set(key, marker);
      }
    });

    // Remove markers that are no longer in the list
    this._quakeMarkers.forEach((marker, key) => {
      if (!seenKeys.has(key)) {
        marker.remove();
        this._quakeMarkers.delete(key);
      }
    });

    this._autoZoom(bounds);
  }

  private _autoZoom(bounds: LngLatBounds): void {
    if (!this._map || this._userInteractedWithMap || bounds.isEmpty()) return;

    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const isRealBounds = northEast.lng !== southWest.lng || northEast.lat !== southWest.lat;

    // First fit snaps directly instead of flying in from the initial [0,0]/zoom-0 view.
    const animate = this._hasAutoZoomedOnce;
    this._hasAutoZoomedOnce = true;

    this._beginProgrammaticMapChange();
    if (isRealBounds) {
      this._map.fitBounds(bounds, { padding: 30, maxZoom: 12, animate });
    } else {
      this._map.jumpTo({ center: northEast, zoom: Math.max(this._map.getZoom(), 8) });
    }
  }

  private _updateRecenterButtonState(): void {
    if (!this._recenterButton) return;

    const autoZoomActive = !this._userInteractedWithMap;
    this._recenterButton.classList.toggle('active', autoZoomActive);
    // aria-label always names the action; the tooltip additionally reflects current state.
    this._recenterButton.setAttribute('aria-label', localize(this.hass, 'card.recenter_map'));
    this._recenterButton.title = autoZoomActive
      ? localize(this.hass, 'card.autozoom_enabled')
      : localize(this.hass, 'card.recenter_map');
  }

  private _destroyMap(): void {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._programmaticChangeSettleTimer) {
      window.clearTimeout(this._programmaticChangeSettleTimer);
      this._programmaticChangeSettleTimer = undefined;
    }
    this._stopCoreTilesTokenRefresh();
    this._coreTilesToken = null;
    this._programmaticMapChange = false;
    if (this._map) {
      try {
        this._map.remove();
      } catch (err) {
        console.warn('[EarthquakeList Map] Error removing map:', err);
      }
      this._map = undefined;
      this._quakeMarkers.clear();
      this._recenterButton = undefined;
      this._userInteractedWithMap = false;
      this._hasAutoZoomedOnce = false;
    }
  }

  protected render() {
    return html`<div id="map-container" class="map-container"></div>`;
  }

  static styles = [maplibreCss, mapStyles];
}

const ELEMENT_NAME = 'earthquakelist-map';

// Guarded for the same reason as the card: a duplicate Lovelace resource loads
// this bundle twice, and the second define() would throw.
if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, EarthquakeListMap);
}
