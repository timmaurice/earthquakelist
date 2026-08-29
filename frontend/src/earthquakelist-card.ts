import { LitElement, html, css, TemplateResult, unsafeCSS, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import styles from './styles/card.styles.scss';
import './components/map';
import { EarthquakeListCardConfig, EarthquakeListItem, HomeAssistant, LovelaceCard, LovelaceCardEditor } from './types';
import { fireEvent, formatRelativeTime, magnitudeSeverity } from './utils';
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
        mmi: attrs.mmi,
        felt: attrs.felt,
        significance: attrs.significance,
        usgs_code: attrs.usgs_code,
        news_link: attrs.news_link,
        news_title: attrs.news_title,
        offshore: attrs.offshore,
        local_timezone: attrs.local_timezone,
        local_timezone_short: attrs.local_timezone_short,
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
    const impactLevel = this._impactAlertLevel(latest);
    const maxItems = this._config.max_list_items ?? 5;

    return html`
      <div class="place-row">
        <div class="place-header">
          <span class="place-name-group">
            <span class="place-name">${name}</span>
            <ha-icon
              class="entity-info-button"
              icon="mdi:information-outline"
              role="button"
              tabindex="0"
              aria-label=${localize(this.hass, 'card.show_details')}
              title=${localize(this.hass, 'card.show_details')}
              @click=${() => this._showMoreInfo(place.entityId)}
              @keydown=${(e: KeyboardEvent) => this._handleEntityLinkKeydown(e, place.entityId)}
            ></ha-icon>
          </span>
          <span class="place-time">${timeAgo}</span>
        </div>

        <div class="summary">
          <div class="magnitude-badge ${severity}">
            ${latest.magnitude !== undefined ? latest.magnitude.toFixed(1) : '?'}
          </div>
          <div class="summary-details">
            <span class="summary-location">${latest.place ?? latest.location ?? '—'}</span>
            <span class="summary-meta">${this._renderMetaChips(latest)}</span>
          </div>
        </div>

        ${
          latest.alert_tsunami || impactLevel
            ? html`<div class="alert-badges">
                ${
                  latest.alert_tsunami
                    ? html`<div class="alert-badge tsunami" title=${localize(this.hass, 'card.tsunami_hint')}>
                        <ha-icon icon="mdi:tsunami"></ha-icon>${localize(this.hass, 'card.tsunami_alert')}
                      </div>`
                    : nothing
                }
                ${
                  impactLevel
                    ? html`<div class="alert-badge impact-${impactLevel}">
                        <ha-icon icon="mdi:alert"></ha-icon>${localize(this.hass, `card.alert_${impactLevel}`)}
                      </div>`
                    : nothing
                }
              </div>`
            : nothing
        }
        ${this._renderNewsLink(latest)}
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
                  <div class="quake-list-title">${localize(this.hass, 'card.previous_earthquakes')}</div>
                  ${earthquakes.slice(1, 1 + maxItems).map((eq) => this._renderQuakeItem(eq))}
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  // USGS PAGER impact level, which is separate from a tsunami alert. `green` is the
  // "no response needed" level, so surfacing it as a warning would just cry wolf —
  // in practice almost every quake the API returns carries green.
  private _impactAlertLevel(eq: EarthquakeListItem): 'yellow' | 'orange' | 'red' | undefined {
    const level = eq.alert_level?.toLowerCase();
    return level === 'yellow' || level === 'orange' || level === 'red' ? level : undefined;
  }

  private _showMoreInfo(entityId: string): void {
    fireEvent(this, 'hass-more-info', { entityId });
  }

  private _handleEntityLinkKeydown(e: KeyboardEvent, entityId: string): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this._showMoreInfo(entityId);
  }

  private _renderMetaChips(eq: EarthquakeListItem): TemplateResult[] {
    const chips: TemplateResult[] = [];
    if (eq.distance_km !== undefined) {
      const distance = `${Math.round(eq.distance_km)} km ${eq.direction ?? ''}`.trim();
      chips.push(
        html`<span class="meta-chip" title=${localize(this.hass, 'card.distance')}>
          <ha-icon icon="mdi:map-marker-distance"></ha-icon>${distance}
        </span>`,
      );
    }
    if (eq.depth_km !== undefined) {
      chips.push(
        html`<span class="meta-chip" title=${localize(this.hass, 'card.depth')}>
          <ha-icon icon="mdi:arrow-expand-down"></ha-icon>${Math.round(eq.depth_km)} km
        </span>`,
      );
    }
    if (eq.offshore) {
      chips.push(
        html`<span class="meta-chip" title=${localize(this.hass, 'card.offshore')}>
          <ha-icon icon="mdi:waves"></ha-icon>
        </span>`,
      );
    }
    if (eq.felt !== undefined && eq.felt > 0) {
      chips.push(
        html`<span class="meta-chip" title=${localize(this.hass, 'card.felt_reports', { count: eq.felt })}>
          <ha-icon icon="mdi:account-voice"></ha-icon>${eq.felt}
        </span>`,
      );
    }
    return chips;
  }

  private _renderNewsLink(eq: EarthquakeListItem): TemplateResult | typeof nothing {
    if (!eq.news_link) return nothing;
    return html`<a class="news-link" href=${eq.news_link} target="_blank" rel="noopener noreferrer">
      <ha-icon icon="mdi:newspaper-variant-outline"></ha-icon>${eq.news_title ?? localize(this.hass, 'card.read_more')}
    </a>`;
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
              eq.alert_tsunami
                ? html`<ha-icon
                    class="quake-item-tsunami"
                    icon="mdi:tsunami"
                    title=${`${localize(this.hass, 'card.tsunami_alert')} — ${localize(this.hass, 'card.tsunami_hint')}`}
                  ></ha-icon>`
                : nothing
            }
            ${
              this._impactAlertLevel(eq)
                ? html`<ha-icon
                    class="quake-item-impact impact-${this._impactAlertLevel(eq)}"
                    icon="mdi:alert"
                    title=${localize(this.hass, `card.alert_${this._impactAlertLevel(eq)}`)}
                  ></ha-icon>`
                : nothing
            }
          </span>
          <span class="quake-item-meta">${this._renderMetaChips(eq)}</span>
          ${this._renderNewsLink(eq)}
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
