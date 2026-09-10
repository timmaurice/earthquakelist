import { describe, it, expect } from 'vitest';
import { EarthquakeListCard } from '../src/earthquakelist-card';
import { EarthquakeListCardEditor } from '../src/editor';
import { CARD_DEFAULTS } from '../src/defaults';
import { EarthquakeListCardConfig } from '../src/types';

const PLACES = ['sensor.earthquakelist_corfu_latest_earthquake'];

function cardDefaults(): Record<string, unknown> {
  const card = new EarthquakeListCard();
  card.setConfig({ type: 'custom:earthquakelist-card', places: PLACES });
  const config = { ...(card as unknown as { _config: EarthquakeListCardConfig })._config } as Record<string, unknown>;
  delete config.type;
  delete config.places;
  return config;
}

function editorFormDefaults(): Record<string, unknown> {
  const editor = new EarthquakeListCardEditor();
  editor.setConfig({ type: 'custom:earthquakelist-card', places: PLACES });
  const formData = {
    ...(editor as unknown as { _formData: EarthquakeListCardConfig })._formData,
  } as Record<string, unknown>;
  delete formData.type;
  delete formData.places;
  return formData;
}

describe('card and editor defaults', () => {
  // The editor deletes any value that equals one of its defaults before saving, and
  // the card fills the gap back in from its own table. That round-trip is only
  // behaviour-neutral while the two tables are identical: if either drifts, every
  // dashboard the editor has touched silently changes behaviour with no error.
  it('agree, so what the editor strips is exactly what the card puts back', () => {
    expect(editorFormDefaults()).toEqual(cardDefaults());
  });

  it('both come from CARD_DEFAULTS rather than a hand-copied table', () => {
    expect(cardDefaults()).toEqual(CARD_DEFAULTS);
    expect(editorFormDefaults()).toEqual(CARD_DEFAULTS);
  });

  it('survive the editor stripping them: a stripped config renders identically', () => {
    const editor = new EarthquakeListCardEditor();
    editor.setConfig({ type: 'custom:earthquakelist-card', places: PLACES });

    let saved: EarthquakeListCardConfig | undefined;
    editor.addEventListener('config-changed', (ev) => {
      saved = (ev as CustomEvent).detail.config;
    });
    (editor as unknown as { _valueChanged: (ev: CustomEvent) => void })._valueChanged(
      new CustomEvent('value-changed', {
        detail: { value: { type: 'custom:earthquakelist-card', places: PLACES, ...CARD_DEFAULTS } },
      }),
    );

    // Every default was stripped out of the stored YAML ...
    expect(saved).toEqual({ type: 'custom:earthquakelist-card', places: PLACES });

    // ... and the card puts every one of them back unchanged.
    const card = new EarthquakeListCard();
    card.setConfig(saved as EarthquakeListCardConfig);
    expect((card as unknown as { _config: EarthquakeListCardConfig })._config).toEqual({
      type: 'custom:earthquakelist-card',
      places: PLACES,
      ...CARD_DEFAULTS,
    });
  });
});
