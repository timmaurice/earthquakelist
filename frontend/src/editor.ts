import { LitElement, html, css, TemplateResult, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EarthquakeListCardConfig, HomeAssistant, LovelaceCardEditor } from './types';
import { localize } from './localize';
import { fireEvent } from './utils';
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
};

const PLACES_SCHEMA: HaFormSchema[] = [
  { name: 'places', selector: { entity: { multiple: true, filter: { integration: 'earthquakelist' } } } },
];

function displaySchema(showList: boolean): HaFormSchema[] {
  return [
    { name: 'title', selector: { text: {} } },
    { name: 'show_map', selector: { boolean: {} } },
    { name: 'show_list', selector: { boolean: {} } },
    ...(showList ? [{ name: 'max_list_items', selector: { number: { min: 1, max: 20, step: 1, mode: 'box' } } }] : []),
  ];
}

@customElement('earthquakelist-card-editor')
export class EarthquakeListCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config!: EarthquakeListCardConfig;

  public setConfig(config: EarthquakeListCardConfig): void {
    this._config = { show_map: true, show_list: true, max_list_items: 5, ...config };
  }

  private _computeLabel = (schema: HaFormSchema): string => {
    const key = FIELD_LABELS[schema.name];
    return key ? localize(this.hass, key) : '';
  };

  private _valueChanged(ev: CustomEvent): void {
    const newConfig = ev.detail.value as EarthquakeListCardConfig;
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
              .data=${this._config}
              .schema=${displaySchema(this._config.show_list !== false)}
              .computeLabel=${this._computeLabel}
              @value-changed=${this._valueChanged}
            ></ha-form>
          </div>

          <div class="option-group">
            <div class="option-group-title">${localize(this.hass, 'editor.places')}</div>
            <ha-form
              .hass=${this.hass}
              .data=${this._config}
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

declare global {
  interface HTMLElementTagNameMap {
    'earthquakelist-card-editor': EarthquakeListCardEditor;
  }
}
