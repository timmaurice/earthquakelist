import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { Map as LeafletMap, LayerGroup, DivIcon, Marker, LatLngBounds } from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css';
import leafletStyles from '../styles/leaflet-styles.scss';
import { EarthquakeListItem, HomeAssistant } from '../types';
import { magnitudeSeverity } from '../utils';

export class EarthquakeListMap extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public earthquakes: EarthquakeListItem[] = [];

  private _map: LeafletMap | undefined = undefined;
  private _markers: LayerGroup | undefined = undefined;
  private _quakeMarkers: Map<string, Marker> = new Map();
  private _leaflet: typeof import('leaflet') | undefined;
  private _resizeObserver: ResizeObserver | null = null;
  private _isInitializingMap = false;
  private _userInteractedWithMap = false;

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

  private async _getLeaflet() {
    if (!this._leaflet) {
      const L = (await import('leaflet')) as typeof import('leaflet') & { noConflict?: () => typeof import('leaflet') };
      this._leaflet = typeof L.noConflict === 'function' ? L.noConflict() : L;
    }
    return this._leaflet!;
  }

  private _markerKey(eq: EarthquakeListItem): string {
    return eq.id ?? `${eq.latitude},${eq.longitude},${eq.time}`;
  }

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
      const L = await this._getLeaflet();
      if (!this.isConnected || this._map) return;

      const darkMode = this.hass?.themes?.darkMode ?? false;
      const tileUrl = darkMode
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

      this._map = L.map(mapContainer, { zoomControl: true });
      L.tileLayer(tileUrl, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(this._map);

      this._markers = L.layerGroup().addTo(this._map);

      this._map.on('zoomstart movestart dragstart', () => {
        this._userInteractedWithMap = true;
      });

      const recenterControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: () => {
          const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
          const link = L.DomUtil.create('a', 'recenter-button', container);
          link.innerHTML = `<ha-icon icon="mdi:crosshairs-gps"></ha-icon>`;
          link.href = '#';
          link.title = 'Recenter map';
          link.setAttribute('role', 'button');
          link.setAttribute('aria-label', 'Recenter map');
          L.DomEvent.on(link, 'click', L.DomEvent.stop).on(link, 'click', () => {
            this._userInteractedWithMap = false;
            this._updateMapMarkers();
          });
          return container;
        },
      });
      this._map.addControl(new recenterControl());

      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObserver = new ResizeObserver(() => this._map?.invalidateSize());
        this._resizeObserver.observe(mapContainer);
      }

      this._map.invalidateSize();
      this._updateMapMarkers();
    } catch (err) {
      console.error('[EarthquakeList Map] Failed to initialize map:', err);
    } finally {
      this._isInitializingMap = false;
    }
  }

  private async _updateMapMarkers(): Promise<void> {
    if (!this._map) return;
    const L = await this._getLeaflet();
    if (!this._map || !this.isConnected) return;

    if (!this._markers) {
      this._markers = L.layerGroup().addTo(this._map);
    }

    const bounds = L.latLngBounds([]);
    const seenKeys = new Set<string>();

    this.earthquakes.forEach((eq, index) => {
      if (eq.latitude === undefined || eq.longitude === undefined) return;
      const key = this._markerKey(eq);
      seenKeys.add(key);
      bounds.extend([eq.latitude, eq.longitude]);

      const severity = magnitudeSeverity(eq.magnitude);
      const size = 18 + Math.round((eq.magnitude ?? 3) * 2);
      const isLatest = index === 0;

      if (!this._quakeMarkers.has(key)) {
        const icon: DivIcon = L.divIcon({
          html: `<div class="leaflet-eq-marker ${severity}" style="width:${size}px;height:${size}px;">${
            eq.magnitude !== undefined ? eq.magnitude.toFixed(1) : ''
          }</div>`,
          className: `leaflet-eq-marker-wrapper${isLatest ? ' latest' : ''}`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
        const marker = L.marker([eq.latitude, eq.longitude], { icon }).addTo(this._markers!);
        const time = eq.time ? new Date(eq.time).toLocaleString(this.hass?.language) : '';
        marker.bindPopup(
          `<strong>M${eq.magnitude?.toFixed(1) ?? '?'}</strong> ${eq.place ?? eq.location ?? ''}<br>${time}`,
        );
        this._quakeMarkers.set(key, marker);
      }
    });

    // Remove markers that are no longer in the list
    this._quakeMarkers.forEach((marker, key) => {
      if (!seenKeys.has(key)) {
        this._markers?.removeLayer(marker);
        this._quakeMarkers.delete(key);
      }
    });

    this._autoZoom(bounds);
  }

  private _autoZoom(bounds: LatLngBounds): void {
    if (!this._map || this._userInteractedWithMap || !bounds.isValid()) return;
    this._map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
  }

  private _destroyMap(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._map) {
      try {
        this._map.remove();
      } catch (err) {
        console.warn('[EarthquakeList Map] Error removing map:', err);
      }
      this._map = undefined;
      this._markers = undefined;
      this._quakeMarkers.clear();
      this._userInteractedWithMap = false;
    }
  }

  protected render() {
    return html`<div id="map-container" class="leaflet-map"></div>`;
  }

  static styles = [leafletCss, leafletStyles];
}

customElements.define('earthquakelist-map', EarthquakeListMap);
