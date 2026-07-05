import { HomeAssistant } from './types';

/**
 * Dispatches a custom event with an optional detail value.
 *
 * @param node The element to dispatch the event from.
 * @param type The name of the event.
 * @param detail The detail value to pass with the event.
 * @param options The options for the event.
 */
export const fireEvent = <T>(
  node: HTMLElement | Window,
  type: string,
  detail?: T,
  options?: CustomEventInit<T>,
): void => {
  const event = new CustomEvent(type, { bubbles: true, cancelable: false, composed: true, ...options, detail });
  node.dispatchEvent(event);
};

/**
 * Formats a date string or object into a relative time string (e.g., "5 minutes ago").
 * @param date The date to format.
 * @param hass The Home Assistant object, used for locale and language settings.
 * @returns A formatted relative time string.
 */
export function formatRelativeTime(date: string | Date, hass?: HomeAssistant): string {
  const dateObj = new Date(date);
  const now = new Date();
  const diffSeconds = Math.round((now.getTime() - dateObj.getTime()) / 1000);

  try {
    const rtf = new Intl.RelativeTimeFormat(hass?.language ?? 'en', { numeric: 'auto' });

    if (Math.abs(diffSeconds) < 60) {
      return rtf.format(-diffSeconds, 'second');
    }
    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) {
      return rtf.format(-diffMinutes, 'minute');
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
      return rtf.format(-diffHours, 'hour');
    }
    const diffDays = Math.round(diffHours / 24);
    return rtf.format(-diffDays, 'day');
  } catch {
    return dateObj.toLocaleString(hass?.language ?? 'en');
  }
}

/**
 * Returns a severity bucket for an earthquake magnitude, used to color-code
 * the magnitude badge and map markers consistently across the card.
 */
export function magnitudeSeverity(magnitude: number | undefined): 'minor' | 'light' | 'moderate' | 'strong' {
  if (magnitude === undefined) return 'minor';
  if (magnitude >= 6) return 'strong';
  if (magnitude >= 5) return 'moderate';
  if (magnitude >= 4) return 'light';
  return 'minor';
}
