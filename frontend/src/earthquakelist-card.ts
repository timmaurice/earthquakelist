import { LitElement, html, css, TemplateResult, unsafeCSS, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import styles from './styles/card.styles.scss';
import './components/map';
import { EarthquakeListCardConfig, EarthquakeListItem, HomeAssistant, LovelaceCard, LovelaceCardEditor } from './types';
import { formatRelativeTime, magnitudeSeverity } from './utils';
import { localize } from './localize';

interface ResolvedPlace {
  entityId: string;
}

export class EarthquakeListCard extends LitElement implements LovelaceCard {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: EarthquakeListCardConfig;

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await import('./editor');
    return document.createElement('earthquakelist-card-editor') as unknown as LovelaceCardEditor;
  }

  public static getStubConfig(): EarthquakeListCardConfig {
    return { type: 'custom:earthquakelist-card', places: [] };
  }

  public setConfig(config: EarthquakeListCardConfig): void {
    if (!config.places || !Array.isArray(config.places) || config.places.length === 0) {
      throw new Error(localize(undefined, 'common.errors.no_places'));
    }
    this._config = {
      show_map: true,
      show_list: true,
      max_list_items: 5,
      ...config,
    };
  }

  public getCardSize(): number {
    return (this._config?.places?.length ?? 1) * 3;
  }

  private _resolvePlaces(): ResolvedPlace[] {
    if (!this._config) return [];
    return this._config.places.filter(Boolean).map((entityId) => ({ entityId }));
  }

  private _earthquakesFor(entityId: string): EarthquakeListItem[] {
    const stateObj = this.hass.states[entityId];
    if (!stateObj) return [];

    const attrs = stateObj.attributes;
    if (attrs.earthquakes?.length) {
      return attrs.earthquakes;
    }

    const magnitude =
      stateObj.state !== 'unknown' && stateObj.state !== 'unavailable' ? parseFloat(stateObj.state) : undefined;
    if (magnitude === undefined || Number.isNaN(magnitude)) return [];

    return [
      {
        magnitude,
        place: attrs.place,
        location: attrs.location,
        time: attrs.time,
        latitude: attrs.latitude,
        longitude: attrs.longitude,
        depth_km: attrs.depth_km,
        distance_km: attrs.distance_km,
        direction: attrs.direction,
        alert_tsunami: attrs.alert_tsunami,
        alert_level: attrs.alert_level,
      },
    ];
  }

  protected render(): TemplateResult {
    if (!this._config || !this.hass) return html``;

    const places = this._resolvePlaces();

    return html`
      <ha-card .header=${this._config.title}>
        <div class="card-content">${places.map((place) => this._renderPlace(place))}</div>
      </ha-card>
    `;
  }

  private _renderPlace(place: ResolvedPlace): TemplateResult {
    const stateObj = this.hass.states[place.entityId];
    const name = stateObj?.attributes.monitored_place ?? stateObj?.attributes.friendly_name ?? place.entityId;
    const earthquakes = this._earthquakesFor(place.entityId);

    if (!stateObj || earthquakes.length === 0) {
      return html`
        <div class="place-row">
          <div class="place-header">
            <span class="place-name">${name}</span>
          </div>
          <div class="empty-state">${localize(this.hass, 'card.no_data')}</div>
        </div>
      `;
    }

    const latest = earthquakes[0];
    const severity = magnitudeSeverity(latest.magnitude);
    const timeAgo = latest.time ? formatRelativeTime(latest.time, this.hass) : '';
    const showAlert = Boolean(latest.alert_tsunami) || Boolean(latest.alert_level);
    const maxItems = this._config.max_list_items ?? 5;

    return html`
      <div class="place-row">
        <div class="place-header">
          <span class="place-name">${name}</span>
          <span class="place-time">${timeAgo}</span>
        </div>

        <div class="summary">
          <div class="magnitude-badge ${severity}">
            ${latest.magnitude !== undefined ? latest.magnitude.toFixed(1) : '?'}
          </div>
          <div class="summary-details">
            <span class="summary-location">${latest.place ?? latest.location ?? '—'}</span>
            <span class="summary-meta">
              ${
                latest.distance_km !== undefined
                  ? `${localize(this.hass, 'card.distance')}: ${Math.round(latest.distance_km)} km ${latest.direction ?? ''}`
                  : ''
              }
              ${
                latest.depth_km !== undefined
                  ? ` · ${localize(this.hass, 'card.depth')}: ${Math.round(latest.depth_km)} km`
                  : ''
              }
            </span>
          </div>
        </div>

        ${
          showAlert
            ? html`<div class="alert-badge">
                <ha-icon icon="mdi:tsunami"></ha-icon>${localize(this.hass, 'card.tsunami_alert')}
              </div>`
            : nothing
        }
        ${
          this._config.show_map
            ? html`<div class="map-wrapper">
                <earthquakelist-map .hass=${this.hass} .earthquakes=${earthquakes}></earthquakelist-map>
              </div>`
            : nothing
        }
        ${
          this._config.show_list && earthquakes.length > 1
            ? html`
                <div class="quake-list">
                  <div class="quake-list-title">${localize(this.hass, 'card.recent_earthquakes')}</div>
                  ${earthquakes.slice(1, 1 + maxItems).map((eq) => this._renderQuakeItem(eq))}
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private _renderQuakeItem(eq: EarthquakeListItem): TemplateResult {
    const severity = magnitudeSeverity(eq.magnitude);
    const timeAgo = eq.time ? formatRelativeTime(eq.time, this.hass) : '';
    return html`
      <div class="quake-item">
        <div class="quake-item-magnitude ${severity}">
          ${eq.magnitude !== undefined ? eq.magnitude.toFixed(1) : '?'}
        </div>
        <div class="quake-item-info">
          <span class="quake-item-place">
            ${eq.place ?? eq.location ?? '—'}
            ${
              eq.alert_tsunami || eq.alert_level
                ? html`<ha-icon
                    class="quake-item-tsunami"
                    icon="mdi:tsunami"
                    title=${localize(this.hass, 'card.tsunami_alert')}
                  ></ha-icon>`
                : nothing
            }
          </span>
          <span class="quake-item-meta">
            ${eq.distance_km !== undefined ? `${Math.round(eq.distance_km)} km ${eq.direction ?? ''}` : ''}
            ${eq.depth_km !== undefined ? ` · ${localize(this.hass, 'card.depth')}: ${Math.round(eq.depth_km)} km` : ''}
          </span>
        </div>
        <div class="quake-item-time">${timeAgo}</div>
      </div>
    `;
  }

  static styles = css`
    ${unsafeCSS(styles)}
  `;
}

customElements.define('earthquakelist-card', EarthquakeListCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'earthquakelist-card',
  name: 'Earthquake List Card',
  description: 'Display recent earthquakes for a monitored location, with a map and list.',
  preview: true,
  documentationURL: 'https://github.com/timmaurice/earthquakelist',
  getEntitySuggestion: (hass, entityId) => {
    if (hass.entities[entityId]?.platform !== 'earthquakelist') {
      return null;
    }
    return {
      config: { type: 'custom:earthquakelist-card', places: [entityId] },
    };
  },
});
