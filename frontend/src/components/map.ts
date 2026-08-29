import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { Map as MapLibreMap, Marker, LngLatBounds, IControl } from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import mapStyles from '../styles/map-styles.scss';
import { EarthquakeListItem, HomeAssistant } from '../types';
import { magnitudeSeverity } from '../utils';
import { localize } from '../localize';

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
      // Stay on v5.
      this._maplibregl = await import('maplibre-gl');
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

  private _buildPopupHtml(eq: EarthquakeListItem): string {
    const time = this._formatPopupTime(eq);
    const place = this._escapeHtml(eq.place ?? eq.location ?? '');
    const lines = [`<strong>M${eq.magnitude?.toFixed(1) ?? '?'}</strong> ${place}`, time];

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
    if (chips.length) lines.push(`<div class="popup-chips">${chips.join('')}</div>`);

    if (eq.news_link && /^https?:\/\//i.test(eq.news_link)) {
      const href = this._escapeHtml(eq.news_link);
      const label = this._escapeHtml(eq.news_title ?? localize(this.hass, 'card.read_more'));
      lines.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    }
    return lines.filter(Boolean).join('<br>');
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
      const styleUrl = darkMode
        ? 'https://tiles.openfreemap.org/styles/dark'
        : 'https://tiles.openfreemap.org/styles/positron';

      this._map = new maplibregl.Map({
        container: mapContainer,
        style: styleUrl,
        center: [0, 0],
        zoom: 0,
        attributionControl: false,
      });

      this._map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      this._collapseAttributionOnce(mapContainer);
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
