import { describe, it, expect, vi, afterEach } from 'vitest';
import { EarthquakeListCardEditor } from '../src/editor';
import { EarthquakeListCardConfig, HomeAssistant } from '../src/types';

function makeHass(): HomeAssistant {
  return {
    states: {},
    entities: {},
    devices: {},
    localize: (key: string) => key,
    language: 'en',
    locale: { language: 'en', number_format: 'comma_decimal', time_format: '24' },
    callWS: async () => ({}) as never,
  } as HomeAssistant;
}

describe('EarthquakeListCardEditor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is defined', () => {
    expect(customElements.get('earthquakelist-card-editor')).toBeDefined();
  });

  it('applies defaults on setConfig', () => {
    const editor = new EarthquakeListCardEditor();
    editor.setConfig({ type: 'custom:earthquakelist-card', places: ['sensor.earthquakelist_corfu_latest_earthquake'] });
    const config = (editor as unknown as { _config: EarthquakeListCardConfig })._config;
    expect(config.show_map).toBe(true);
    expect(config.show_list).toBe(true);
    expect(config.max_list_items).toBe(5);
  });

  it('updates config and fires config-changed on ha-form value-changed', async () => {
    const editor = new EarthquakeListCardEditor();
    editor.hass = makeHass();
    editor.setConfig({
      type: 'custom:earthquakelist-card',
      places: ['sensor.earthquakelist_corfu_latest_earthquake'],
    });
    document.body.appendChild(editor);
    await editor.updateComplete;

    const handler = vi.fn();
    editor.addEventListener('config-changed', handler);

    const currentConfig = (editor as unknown as { _config: EarthquakeListCardConfig })._config;
    (editor as unknown as { _valueChanged: (ev: CustomEvent) => void })._valueChanged(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...currentConfig,
            places: ['sensor.earthquakelist_corfu_latest_earthquake', 'sensor.earthquakelist_japan_latest_earthquake'],
          },
        },
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const config = (editor as unknown as { _config: EarthquakeListCardConfig })._config;
    expect(config.places).toEqual([
      'sensor.earthquakelist_corfu_latest_earthquake',
      'sensor.earthquakelist_japan_latest_earthquake',
    ]);
  });
});
