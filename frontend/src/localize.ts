import { HomeAssistant } from './types';

import en from './translation/en.json';
import de from './translation/de.json';
import es from './translation/es.json';
import es419 from './translation/es-419.json';
import id from './translation/id.json';
import ja from './translation/ja.json';
import zhHans from './translation/zh-Hans.json';
import zhHant from './translation/zh-Hant.json';

// Keys must match Home Assistant's own language codes (`hass.language`).
const translations = {
  en,
  de,
  es,
  'es-419': es419,
  id,
  ja,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

interface TranslationObject {
  [key: string]: string | TranslationObject;
}

const typedTranslations: { [key: string]: TranslationObject } = translations;

function _getTranslation(language: string, keys: string[]): string | undefined {
  let translation: string | TranslationObject | undefined = typedTranslations[language];
  for (const key of keys) {
    if (typeof translation !== 'object' || translation === null) {
      return undefined;
    }
    translation = translation[key];
  }
  return typeof translation === 'string' ? translation : undefined;
}

export function localize(
  hass: HomeAssistant | undefined,
  key: string,
  placeholders: Record<string, string | number> = {},
): string {
  const lang = hass?.language || 'en';
  const translationKey = key.replace('component.earthquakelist-card.', '');
  const keyParts = translationKey.split('.');

  // Exact match first, then the base language (so e.g. `es-419` still resolves via `es`,
  // and a regional variant we don't ship falls back to its language), then English.
  const baseLang = lang.split('-')[0];
  const translation =
    _getTranslation(lang, keyParts) ?? _getTranslation(baseLang, keyParts) ?? _getTranslation('en', keyParts);

  if (typeof translation === 'string') {
    let finalString = translation;
    for (const placeholder in placeholders) {
      finalString = finalString.replace(`{${placeholder}}`, String(placeholders[placeholder]));
    }
    return finalString;
  }

  return key;
}
