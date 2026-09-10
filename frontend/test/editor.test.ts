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

  it('shows the defaults in the form without writing them into the config', () => {
    const editor = new EarthquakeListCardEditor();
    editor.setConfig({ type: 'custom:earthquakelist-card', places: ['sensor.earthquakelist_corfu_latest_earthquake'] });

    const config = (editor as unknown as { _config: EarthquakeListCardConfig })._config;
    expect(config.show_map).toBeUndefined();
    expect(config.show_list).toBeUndefined();
    expect(config.max_list_items).toBeUndefined();

    const formData = (editor as unknown as { _formData: EarthquakeListCardConfig })._formData;
    expect(formData.show_map).toBe(true);
    expect(formData.show_list).toBe(true);
    expect(formData.max_list_items).toBe(5);
    expect(formData.max_map_markers).toBe(10);
  });

  it('labels every field it renders, including max_map_markers', () => {
    const editor = new EarthquakeListCardEditor();
    editor.hass = makeHass();
    const computeLabel = (editor as unknown as { _computeLabel: (s: { name: string }) => string })._computeLabel;

    expect(computeLabel({ name: 'max_map_markers' })).toBe('Max. map markers');
    expect(computeLabel({ name: 'max_list_items' })).toBe('Max. list items');
  });

  it('strips values that only repeat a default before saving', () => {
    const editor = new EarthquakeListCardEditor();
    editor.hass = makeHass();
    editor.setConfig({ type: 'custom:earthquakelist-card', places: ['sensor.earthquakelist_corfu_latest_earthquake'] });

    const handler = vi.fn();
    editor.addEventListener('config-changed', handler);
    (editor as unknown as { _valueChanged: (ev: CustomEvent) => void })._valueChanged(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            type: 'custom:earthquakelist-card',
            places: ['sensor.earthquakelist_corfu_latest_earthquake'],
            title: 'Quakes',
            show_map: true,
            show_list: true,
            max_list_items: 5,
            max_map_markers: 10,
          },
        },
      }),
    );

    const saved = handler.mock.calls[0][0].detail.config as EarthquakeListCardConfig;
    expect(saved).toEqual({
      type: 'custom:earthquakelist-card',
      places: ['sensor.earthquakelist_corfu_latest_earthquake'],
      title: 'Quakes',
    });
  });

  it('keeps values that differ from the default', () => {
    const editor = new EarthquakeListCardEditor();
    editor.hass = makeHass();
    editor.setConfig({ type: 'custom:earthquakelist-card', places: ['sensor.earthquakelist_corfu_latest_earthquake'] });

    const handler = vi.fn();
    editor.addEventListener('config-changed', handler);
    (editor as unknown as { _valueChanged: (ev: CustomEvent) => void })._valueChanged(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            type: 'custom:earthquakelist-card',
            places: ['sensor.earthquakelist_corfu_latest_earthquake'],
            show_map: false,
            max_list_items: 3,
          },
        },
      }),
    );

    const saved = handler.mock.calls[0][0].detail.config as EarthquakeListCardConfig;
    expect(saved.show_map).toBe(false);
    expect(saved.max_list_items).toBe(3);
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
