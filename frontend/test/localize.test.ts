import { describe, it, expect } from 'vitest';
import { localize } from '../src/localize';
import { HomeAssistant } from '../src/types';

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
