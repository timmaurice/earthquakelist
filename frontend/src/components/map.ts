import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { Map as MapLibreMap, Marker, LngLatBounds, IControl } from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import mapStyles from '../styles/map-styles.scss';
import { EarthquakeListItem, HomeAssistant } from '../types';
import { magnitudeSeverity } from '../utils';

/**
 * Custom top-left control that lets the user re-enable auto-zoom after they've
 * manually panned/zoomed the map. Mirrors MapLibre's own control chrome
 * (`maplibregl-ctrl`/`maplibregl-ctrl-group`) so it visually matches the built-in
 * zoom control it's stacked beneath.
 */
class RecenterControl implements IControl {
  private _container: HTMLElement | undefined;
  private _link: HTMLAnchorElement | undefined;

  constructor(private readonly onClick: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    const link = document.createElement('a');
    link.className = 'recenter-button';
    link.href = '#';
    link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', 'Recenter map');
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
    if (changedProperties.has('earthquakes')) {
      this._updateMapMarkers();
    }
  }

  private async _getMapLibre() {
    if (!this._maplibregl) {
      // maplibre-gl is pinned to v5 (see package.json): its dist/maplibre-gl.js is a
      // self-contained build that constructs its Web Worker from an inline Blob
      // automatically, no manual setWorkerUrl() wiring needed. v6 dropped that in favor of
      // a separately-hosted worker file, which doesn't fit this project's single-file
      // bundle — don't bump past v5 without re-solving that.
      this._maplibregl = await import('maplibre-gl');
    }
    return this._maplibregl!;
  }

  private _markerKey(eq: EarthquakeListItem): string {
    return eq.id ?? `${eq.latitude},${eq.longitude},${eq.time}`;
  }

  // Marks the next camera movement(s) as programmatic rather than user-initiated, so the
  // zoomstart/movestart/dragstart listeners below don't mistake them for real interaction and
  // disable auto-zoom. Used both for our own fitBounds/jumpTo calls and for `_map.resize()` —
  // MapLibre can reposition the camera during a resize (e.g. on first layout, or whenever the
  // card's container size settles inside HA's grid), and that's just as capable of firing
  // move events as an explicit zoom.
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
      const styleUrl = darkMode
        ? 'https://tiles.openfreemap.org/styles/dark'
        : 'https://tiles.openfreemap.org/styles/positron';

      this._map = new maplibregl.Map({
        container: mapContainer,
        style: styleUrl,
        center: [0, 0],
        zoom: 0,
      });

      this._map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

      const markUserInteracted = () => {
        if (!this._programmaticMapChange) {
          this._userInteractedWithMap = true;
          this._updateRecenterButtonState();
        }
      };
      this._map.on('zoomstart', markUserInteracted);
      this._map.on('movestart', markUserInteracted);
      this._map.on('dragstart', markUserInteracted);
      this._map.on('moveend', this._handleMapMoveEnd);

      const recenterControl = new RecenterControl(() => {
        this._userInteractedWithMap = false;
        this._updateMapMarkers();
        this._updateRecenterButtonState();
      });
      this._map.addControl(recenterControl, 'top-left');
      this._recenterButton = recenterControl.getLink();

      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => {
          if (this._map) {
            this._beginProgrammaticMapChange();
            this._map.resize();
          }
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
      // MapLibre marker elements stack by DOM insertion order when no z-index is set — since
      // the latest quake is inserted first (index 0), older quakes added afterward would
      // otherwise paint over its pulsing halo. Rank newer quakes above older ones instead.
      const zIndex = this.earthquakes.length - index + (isLatest ? 1000 : 0);

      if (!this._quakeMarkers.has(key)) {
        const wrapper = document.createElement('div');
        wrapper.className = `eq-marker-wrapper${isLatest ? ' latest' : ''}`;
        wrapper.style.zIndex = String(zIndex);
        wrapper.innerHTML = `<div class="eq-marker ${severity}" style="width:${size}px;height:${size}px;">${
          eq.magnitude !== undefined ? eq.magnitude.toFixed(1) : ''
        }</div>`;

        const time = eq.time ? new Date(eq.time).toLocaleString(this.hass?.language) : '';
        const popup = new maplibregl.Popup({ offset: size / 2 + 4 }).setHTML(
          `<strong>M${eq.magnitude?.toFixed(1) ?? '?'}</strong> ${eq.place ?? eq.location ?? ''}<br>${time}`,
        );

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

    // The very first fit snaps straight to the target view instead of flying there —
    // otherwise every card load briefly shows the whole world (the map starts at
    // center [0,0]/zoom 0) before animating in.
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

    if (this._userInteractedWithMap) {
      this._recenterButton.classList.remove('active');
      this._recenterButton.setAttribute('aria-label', 'Recenter map and enable auto-zoom');
    } else {
      this._recenterButton.classList.add('active');
      this._recenterButton.title = 'Auto-zoom enabled';
    }
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

customElements.define('earthquakelist-map', EarthquakeListMap);
