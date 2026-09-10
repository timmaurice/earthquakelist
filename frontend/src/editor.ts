import { LitElement, html, css, TemplateResult, unsafeCSS } from 'lit';
import { property, state } from 'lit/decorators.js';
import { EarthquakeListCardConfig, HomeAssistant, LovelaceCardEditor } from './types';
import { localize } from './localize';
import { fireEvent } from './utils';
import { CARD_DEFAULTS, MAX_MAP_MARKERS_LIMIT } from './defaults';
import editorStyles from './styles/editor.styles.scss';

interface HaFormSchema {
  name: string;
  selector: Record<string, unknown>;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'editor.title',
  show_map: 'editor.show_map',
  show_list: 'editor.show_list',
  max_list_items: 'editor.max_list_items',
  // Without this the number box sat in the form with a blank label - the
  // translation key existed in all eight files, it was just never mapped.
  max_map_markers: 'editor.max_map_markers',
  map_tile_source: 'editor.map_tile_source',
};

// The same table setConfig() applies, imported rather than copied: these fill the
// form so the boxes are never blank, and are stripped again before the config is
// saved. Stripping is only behaviour-neutral while the two agree, which is why
// they must not be two tables.
const DEFAULTS: Partial<EarthquakeListCardConfig> = CARD_DEFAULTS;

function stripDefaults(config: EarthquakeListCardConfig): EarthquakeListCardConfig {
  const stripped = { ...config } as Record<string, unknown>;
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stripped[key] === value) {
      delete stripped[key];
    }
  }
  return stripped as EarthquakeListCardConfig;
}

const PLACES_SCHEMA: HaFormSchema[] = [
  { name: 'places', selector: { entity: { multiple: true, filter: { integration: 'earthquakelist' } } } },
];

// `hass` is needed for the option labels: ha-form localizes field names through
// computeLabel, but the options inside a select selector carry their own labels.
function displaySchema(hass: HomeAssistant, showMap: boolean, showList: boolean): HaFormSchema[] {
  return [
    { name: 'title', selector: { text: {} } },
    { name: 'show_map', selector: { boolean: {} } },
    ...(showMap
      ? [
          {
            name: 'max_map_markers',
            selector: { number: { min: 1, max: MAX_MAP_MARKERS_LIMIT, step: 1, mode: 'box' } },
          },
          {
            name: 'map_tile_source',
            selector: {
              select: {
                mode: 'dropdown',
                options: (['auto', 'core', 'openfreemap'] as const).map((value) => ({
                  value,
                  label: localize(hass, `editor.map_tile_source_options.${value}`),
                })),
              },
            },
          },
        ]
      : []),
    { name: 'show_list', selector: { boolean: {} } },
    ...(showList ? [{ name: 'max_list_items', selector: { number: { min: 1, max: 20, step: 1, mode: 'box' } } }] : []),
  ];
}

export class EarthquakeListCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: EarthquakeListCardConfig;

  public setConfig(config: EarthquakeListCardConfig): void {
    this._config = config;
  }

  // What the form shows: the saved config on top of the defaults.
  private get _formData(): EarthquakeListCardConfig {
    return { ...DEFAULTS, ...this._config } as EarthquakeListCardConfig;
  }

  private _computeLabel = (schema: HaFormSchema): string => {
    const key = FIELD_LABELS[schema.name];
    return key ? localize(this.hass, key) : '';
  };

  private _valueChanged(ev: CustomEvent): void {
    const newConfig = stripDefaults(ev.detail.value as EarthquakeListCardConfig);
    this._config = newConfig;
    fireEvent(this, 'config-changed', { config: newConfig });
  }

  protected render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html``;
    }

    return html`
      <ha-card>
        <div class="card-config">
          <div class="option-group">
            <div class="option-group-title">${localize(this.hass, 'editor.groups.display')}</div>
            <ha-form
              .hass=${this.hass}
              .data=${this._formData}
              .schema=${displaySchema(this.hass, this._formData.show_map !== false, this._formData.show_list !== false)}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>

          <div class="option-group">
            <div class="option-group-title">${localize(this.hass, 'editor.places')}</div>
            <ha-form
              .hass=${this.hass}
              .data=${this._formData}
              .schema=${PLACES_SCHEMA}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    ${unsafeCSS(editorStyles)}
  `;
}

const ELEMENT_NAME = 'earthquakelist-card-editor';

// Registered by hand instead of through @customElement: the decorator throws
// when a second copy of this bundle has already claimed the name.
if (!customElements.get(ELEMENT_NAME)) {
  customElements.define(ELEMENT_NAME, EarthquakeListCardEditor);
}

declare global {
  interface HTMLElementTagNameMap {
    'earthquakelist-card-editor': EarthquakeListCardEditor;
  }
}
