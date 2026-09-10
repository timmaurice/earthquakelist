import { describe, it, expect } from 'vitest';
import { localize } from '../src/localize';
import { EarthquakeListCard } from '../src/earthquakelist-card';
import { HomeAssistant } from '../src/types';

import en from '../src/translation/en.json';
import de from '../src/translation/de.json';
import es from '../src/translation/es.json';
import es419 from '../src/translation/es-419.json';
import id from '../src/translation/id.json';
import ja from '../src/translation/ja.json';
import zhHans from '../src/translation/zh-Hans.json';
import zhHant from '../src/translation/zh-Hant.json';

const FILES: Record<string, unknown> = { en, de, es, 'es-419': es419, id, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant };

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function hassWith(language: string): HomeAssistant {
  return { language } as HomeAssistant;
}

describe('localize', () => {
  it('returns the English string by default', () => {
    expect(localize(hassWith('en'), 'card.depth')).toBe('Depth');
  });

  it('resolves a shipped translation for each supported language', () => {
    // Just needs to be translated (i.e. not the English string) and non-empty.
    for (const lang of ['de', 'es', 'id', 'ja', 'zh-Hans', 'zh-Hant']) {
      const value = localize(hassWith(lang), 'card.depth');
      expect(value).toBeTruthy();
      expect(value).not.toBe('Depth');
    }
  });

  it('uses the regional variant when one is shipped', () => {
    // es-419 says "sismo" where es says "terremoto".
    expect(localize(hassWith('es-419'), 'card.previous_earthquakes')).toBe('Sismos anteriores');
    expect(localize(hassWith('es'), 'card.previous_earthquakes')).toBe('Terremotos anteriores');
  });

  it('keeps Simplified and Traditional Chinese distinct', () => {
    // Taiwan uses 規模 for magnitude where the mainland uses 震级 — a shared file would lose that.
    expect(localize(hassWith('zh-Hant'), 'editor.max_list_items')).not.toBe(
      localize(hassWith('zh-Hans'), 'editor.max_list_items'),
    );
  });

  it('falls back to the base language for a regional variant we do not ship', () => {
    expect(localize(hassWith('de-AT'), 'card.depth')).toBe(localize(hassWith('de'), 'card.depth'));
  });

  it('falls back to English for an unsupported language', () => {
    expect(localize(hassWith('xx'), 'card.depth')).toBe('Depth');
  });

  it('substitutes placeholders', () => {
    expect(localize(hassWith('en'), 'card.felt_reports', { count: 42 })).toBe('Felt by 42');
  });

  it('returns the key itself when it does not exist', () => {
    expect(localize(hassWith('en'), 'card.does_not_exist')).toBe('card.does_not_exist');
  });
});

describe('translation files', () => {
  it('ship the same keys in every language', () => {
    const expected = keyPaths(en).sort();
    for (const [lang, file] of Object.entries(FILES)) {
      expect(keyPaths(file).sort(), `${lang}.json is out of parity with en.json`).toEqual(expected);
    }
  });

  it('carry no strings for setConfig, which cannot localize anything', () => {
    // Home Assistant calls setConfig before it assigns hass, so localize() there had
    // no language and always fell back to English. Translating those messages was
    // dead weight in eight files that nothing could ever show; the card throws plain
    // English literals instead. Keep it that way rather than re-adding the keys.
    for (const [lang, file] of Object.entries(FILES)) {
      expect(keyPaths(file), `${lang}.json`).not.toContain('common.errors.no_places');
      expect(keyPaths(file), `${lang}.json`).not.toContain('common.errors.invalid_entity');
    }

    const card = new EarthquakeListCard();
    expect(() => card.setConfig({ type: 'custom:earthquakelist-card' } as never)).toThrow(
      'You need to define at least one place.',
    );
    expect(() => card.setConfig({ type: 'custom:earthquakelist-card', places: ['sun.sun'] })).toThrow(
      'sun.sun is not a sensor entity.',
    );
  });
});
