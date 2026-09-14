import { LitElement, html } from 'lit';
import { property, state } from 'lit/decorators.js';
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
import { EarthquakeListItem, HomeAssistant, MapThemeMode, MapTileSource } from '../types';
import { isSafeUrl, magnitudeSeverity } from '../utils';
import { localize } from '../localize';
import { installMapLibreWorker } from '../maplibre-worker';

type StyleWithUrls = {
  glyphs?: unknown;
  sprite?: unknown;
  sources?: Record<string, Record<string, unknown>>;
};

const OPENFREEMAP_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const OPENFREEMAP_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// ─── Home Assistant's own tile proxy (`map_tiles`, HA 2026.9+) ────────────────────────────
// Requesting the base map straight from OpenFreeMap means every dashboard render sends a
// bounding box around the user's home to a third party, with no way to turn it off.
// `map_tiles` proxies OpenStreetMap through the user's own instance instead.
//
// Its *vector* endpoint is what we use. The proxy ships no style of its own
// (`/api/map_tiles/style.json` is a 404), but Home Assistant itself serves complete MapLibre
// styles at `/static/map/light.json` and `/static/map/dark.json` (versatiles-colorful and
// versatiles-eclipse), which is what those are loaded from. Kept deliberately identical to the
// sibling `lovelace-blitzortung-lightning-card`, whose map component this one shares its shape
// with.
const CORE_TILES_COMPONENT = 'map_tiles';
const CORE_TILES_LIGHT_STYLE = '/static/map/light.json';
const CORE_TILES_DARK_STYLE = '/static/map/dark.json';
// Everything the style then pulls — TileJSON, vector tiles, glyphs, sprites — lives under this
// prefix, and every one of them is refused with 401 unless the request carries a token.
const CORE_TILES_API_PREFIX = '/api/map_tiles/';
// Tokens rotate every 30 minutes, with the previous one staying valid. Renewing well inside
// that window means a tile request is never made with an expired token.
const CORE_TILES_TOKEN_REFRESH_MS = 10 * 60 * 1000;

// Recenter (re-enables auto-zoom after a manual pan) and the interaction lock, kept in one
// control group so they don't stack separate margins and rounded shells on a short map.
// Locking stops the map's drag/zoom gestures, so a swipe over it scrolls the dashboard.
class MapToolsControl implements IControl {
  private _container: HTMLElement | undefined;
  private _recenterLink: HTMLAnchorElement | undefined;
  private _lockLink: HTMLAnchorElement | undefined;

  constructor(
    private readonly onRecenter: () => void,
    private readonly onToggleLock: () => void,
    private readonly recenterLabel: string,
  ) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    this._recenterLink = this._addButton(container, 'recenter-button', 'mdi:crosshairs-gps', this.onRecenter);
    this._recenterLink.setAttribute('aria-label', this.recenterLabel);
    this._lockLink = this._addButton(container, 'lock-button', 'mdi:lock-open-variant', this.onToggleLock);

    this._container = container;
    return container;
  }

  private _addButton(container: HTMLElement, className: string, icon: string, onClick: () => void): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = className;
    link.href = '#';
    link.innerHTML = `<ha-icon icon="${icon}"></ha-icon>`;
    link.setAttribute('role', 'button');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    container.appendChild(link);
    return link;
  }

  onRemove(): void {
    this._container?.remove();
  }

  getRecenterLink(): HTMLAnchorElement | undefined {
    return this._recenterLink;
  }

  // The label names the action the click performs, not the state it is in.
  setLocked(isLocked: boolean, label: string): void {
    if (!this._lockLink) return;
    this._lockLink.classList.toggle('active', isLocked);
    this._lockLink.setAttribute('aria-label', label);
    this._lockLink.setAttribute('aria-pressed', String(isLocked));
    this._lockLink.title = label;
    this._lockLink.querySelector('ha-icon')?.setAttribute('icon', isLocked ? 'mdi:lock' : 'mdi:lock-open-variant');
  }
}

export class EarthquakeListMap extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public earthquakes: EarthquakeListItem[] = [];
  @property({ attribute: false }) public tileSource: MapTileSource = 'auto';
  @property({ attribute: false }) public themeMode: MapThemeMode = 'auto';
  /** Where the lock starts; the toggle button owns it from there until the config changes. */
  @property({ attribute: false }) public locked = false;

  @state() private _isLocked = false;
  private _map: MapLibreMap | undefined = undefined;
  private _quakeMarkers: Map<string, Marker> = new Map();
  private _maplibregl: typeof import('maplibre-gl') | undefined;
  private _resizeObserver: ResizeObserver | null = null;
  private _isInitializingMap = false;
  // The light/dark choice the live map was built with, so a later theme change can be spotted.
  private _builtDarkMode: boolean | undefined = undefined;
  private _userInteractedWithMap = false;
  private _recenterButton: HTMLAnchorElement | undefined;
  private _mapTools: MapToolsControl | undefined;
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
    // A config change wins over a per-view toggle, or editing the card would leave the map
    // contradicting the setting just saved.
    if (changedProperties.has('locked')) {
      this._isLocked = this.locked;
      this._applyLockedState();
    }
    if (!this._map) {
      this._initMap();
      return;
    }
    // The tile source and the light/dark style are both baked in at construction, so a change
    // to either takes a new map. `_builtDarkMode` is what the current map was actually built
    // with: on `auto` the trigger is Home Assistant's theme changing under us, which arrives as
    // a new `hass` rather than as a changed property of our own.
    if (
      changedProperties.has('tileSource') ||
      changedProperties.has('themeMode') ||
      (this._builtDarkMode !== undefined && this._builtDarkMode !== this._darkMode)
    ) {
      this._destroyMap();
      this._initMap();
      return;
    }
    if (changedProperties.has('earthquakes')) {
      this._updateMapMarkers();
    }
  }

  /** `themeMode` wins where it is set; `auto` follows Home Assistant's own theme. */
  private get _darkMode(): boolean {
    if (this.themeMode === 'dark') return true;
    if (this.themeMode === 'light') return false;
    return this.hass?.themes?.darkMode ?? false;
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
      this._warnCoreTilesFallback('Could not get a map_tiles token', err);
      return null;
    }
  }

  // Once per component, not once per failure: a token fetch that keeps failing would otherwise
  // repeat this on every refresh interval for as long as the dashboard stays open.
  private _warnCoreTilesFallback(message: string, err: unknown): void {
    if (this._coreTilesWarned) {
      return;
    }
    this._coreTilesWarned = true;
    console.warn(`[EarthquakeList Map] ${message}; using OpenFreeMap tiles instead.`, err);
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
    // Absolute first, unconditionally. `_resolveStyleUrls` only reaches URLs written in the
    // style document; the tile templates MapLibre reads out of the proxy's TileJSON at runtime
    // never pass through it and stay root-relative (`/api/map_tiles/vector/...`). Tile requests
    // are handed to the Web Worker, which this card constructs from a Blob URL — and a `blob:`
    // URL is a cannot-be-a-base URL, so resolving a relative URL against it throws
    // `Failed to construct 'Request'` and every vector tile ends up `errored` with the map
    // silently blank. This runs on the main thread, before the URL is passed to the worker, so
    // absolutising here is what makes it resolvable there.
    const absolute = this._toAbsoluteUrl(url);
    if (this._coreTilesToken && this._isCoreTilesUrl(absolute)) {
      const separator = absolute.includes('?') ? '&' : '?';
      return { url: `${absolute}${separator}token=${encodeURIComponent(this._coreTilesToken)}` };
    }
    return { url: absolute };
  };

  // Not just the tiles: the style's TileJSON, glyphs and sprites are all served from the same
  // proxy and all 401 without a token. The path is what identifies them, not a prefix of the
  // string — a third-party URL that merely mentions the proxy in its query must not be handed
  // this instance's token.
  private _isCoreTilesUrl(url: string): boolean {
    try {
      return new URL(url, document.baseURI).pathname.startsWith(CORE_TILES_API_PREFIX);
    } catch {
      return false;
    }
  }

  /**
   * Fetches Home Assistant's style and hands back a MapLibre-ready object, or null to mean
   * "fall back to OpenFreeMap" — the same fallback a failed token gets, and warned the same
   * once-per-component way.
   *
   * The style cannot simply be passed as a URL: MapLibre rejects relative URLs inside a style
   * outright (`Invalid sprite URL "/api/map_tiles/sprites/basics/sprites"`) and stops loading,
   * leaving an empty canvas with no tile, glyph or sprite request made. Home Assistant's own
   * frontend resolves those paths before handing the style over; so does this.
   */
  private async _loadCoreTilesStyle(styleUrl: string): Promise<StyleSpecification | null> {
    try {
      const response = await fetch(styleUrl);
      if (!response.ok) {
        throw new Error(`${styleUrl} responded ${response.status}`);
      }
      return this._resolveStyleUrls(await response.json()) as StyleSpecification;
    } catch (err) {
      this._warnCoreTilesFallback(`Could not load the map_tiles style ${styleUrl}`, err);
      return null;
    }
  }

  /**
   * Rewrites every instance-relative URL in a style to an absolute one: `glyphs`, `sprite`
   * (a string or, as Home Assistant sends it, an array of `{id, url}`), each source's `url`,
   * and any `tiles` a source lists directly.
   */
  private _resolveStyleUrls(style: StyleWithUrls): StyleWithUrls {
    const resolved: StyleWithUrls = { ...style };

    if (typeof style.glyphs === 'string') {
      resolved.glyphs = this._toAbsoluteUrl(style.glyphs);
    }
    if (typeof style.sprite === 'string') {
      resolved.sprite = this._toAbsoluteUrl(style.sprite);
    } else if (Array.isArray(style.sprite)) {
      resolved.sprite = style.sprite.map((entry: unknown) => {
        const sprite = entry as { url?: unknown };
        return typeof sprite?.url === 'string' ? { ...sprite, url: this._toAbsoluteUrl(sprite.url) } : entry;
      });
    }
    if (style.sources && typeof style.sources === 'object') {
      resolved.sources = Object.fromEntries(
        Object.entries(style.sources).map(([id, source]) => {
          const next = { ...source };
          if (typeof next.url === 'string') {
            next.url = this._toAbsoluteUrl(next.url);
          }
          if (Array.isArray(next.tiles)) {
            next.tiles = next.tiles.map((tile: unknown) =>
              typeof tile === 'string' ? this._toAbsoluteUrl(tile) : tile,
            );
          }
          return [id, next];
        }),
      );
    }

    return resolved;
  }

  /**
   * Resolves one style URL against this instance. Only paths are rewritten — an absolute URL
   * or a `data:` URI is already resolvable and is handed back untouched.
   *
   * Concatenation, deliberately, not `new URL(path, origin)`: the URL constructor
   * percent-encodes the placeholders MapLibre substitutes later, so `{fontstack}` becomes
   * `%7Bfontstack%7D` and the glyph and tile requests 404.
   */
  private _toAbsoluteUrl(url: string): string {
    return url.startsWith('/') ? `${window.location.origin}${url}` : url;
  }

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

  private _toggleLocked = (): void => {
    this._isLocked = !this._isLocked;
    this._applyLockedState();
  };

  // Disables MapLibre's camera handlers rather than `pointer-events: none` on the container:
  // the controls live in there too, and a locked map should still answer a tap on a marker.
  private _applyLockedState(): void {
    if (!this._map) return;

    const handlers = [
      this._map.dragPan,
      this._map.scrollZoom,
      this._map.doubleClickZoom,
      this._map.touchZoomRotate,
      this._map.touchPitch,
      this._map.dragRotate,
      this._map.boxZoom,
      this._map.keyboard,
    ];
    handlers.forEach((handler) => (this._isLocked ? handler.disable() : handler.enable()));

    // MapLibre keeps its grab cursor whatever the handlers do; the class drops it.
    this._map.getContainer().classList.toggle('map-locked', this._isLocked);
    this._mapTools?.setLocked(
      this._isLocked,
      localize(this.hass, this._isLocked ? 'card.enable_map_interaction' : 'card.disable_map_interaction'),
    );
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

      const darkMode = this._darkMode;
      this._builtDarkMode = darkMode;

      const useCoreTiles = await this._useCoreTiles();
      if (!this.isConnected || this._map) return;
      if (useCoreTiles) {
        this._startCoreTilesTokenRefresh();
      }

      // Awaited before the map is constructed: MapLibre takes the style once, at construction,
      // and a style that arrives later would mean a visible restyle. A null here means the
      // fetch failed and OpenFreeMap takes over, already warned about.
      const coreStyle = useCoreTiles
        ? await this._loadCoreTilesStyle(darkMode ? CORE_TILES_DARK_STYLE : CORE_TILES_LIGHT_STYLE)
        : null;
      if (!this.isConnected || this._map) return;

      const style: StyleSpecification | string =
        coreStyle ?? (darkMode ? OPENFREEMAP_DARK_STYLE : OPENFREEMAP_LIGHT_STYLE);

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

      const toolsControl = new MapToolsControl(
        () => {
          this._userInteractedWithMap = false;
          this._updateMapMarkers();
          this._updateRecenterButtonState();
        },
        this._toggleLocked,
        localize(this.hass, 'card.recenter_map'),
      );
      this._map.addControl(toolsControl, 'top-left');
      this._mapTools = toolsControl;
      this._recenterButton = toolsControl.getRecenterLink();
      this._applyLockedState();

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

        const darkMode = this._darkMode;
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
    this._builtDarkMode = undefined;
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
      this._mapTools = undefined;
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
