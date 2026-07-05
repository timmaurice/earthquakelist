import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, formatRelativeTime, magnitudeSeverity } from '../src/utils';
import { HomeAssistant } from '../src/types';

function makeHass(language: string): HomeAssistant {
  return { language } as HomeAssistant;
}

describe('magnitudeSeverity', () => {
  it('returns minor for undefined magnitude', () => {
    expect(magnitudeSeverity(undefined)).toBe('minor');
  });

  it('returns minor below 4', () => {
    expect(magnitudeSeverity(3.9)).toBe('minor');
  });

  it('returns light at the 4 boundary', () => {
    expect(magnitudeSeverity(4)).toBe('light');
    expect(magnitudeSeverity(4.9)).toBe('light');
  });

  it('returns moderate at the 5 boundary', () => {
    expect(magnitudeSeverity(5)).toBe('moderate');
    expect(magnitudeSeverity(5.9)).toBe('moderate');
  });

  it('returns strong at the 6 boundary', () => {
    expect(magnitudeSeverity(6)).toBe('strong');
    expect(magnitudeSeverity(7.5)).toBe('strong');
  });
});

describe('formatRelativeTime', () => {
  it('formats a difference of a few seconds', () => {
    const date = new Date(Date.now() - 30 * 1000);
    expect(formatRelativeTime(date, makeHass('en'))).toMatch(/second/);
  });

  it('formats a difference of a few minutes', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(date, makeHass('en'))).toMatch(/minute/);
  });

  it('formats a difference of a few hours', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, makeHass('en'))).toMatch(/hour/);
  });

  it('formats a difference of a few days', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date, makeHass('en'))).toMatch(/day/);
  });

  it('defaults to english when no hass is given', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toMatch(/day/);
  });

  it('respects the hass language', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const en = formatRelativeTime(date, makeHass('en'));
    const de = formatRelativeTime(date, makeHass('de'));
    expect(de).not.toBe(en);
  });

  it('falls back to toLocaleString if Intl.RelativeTimeFormat throws', () => {
    const intl = Intl as unknown as { RelativeTimeFormat: unknown };
    const original = intl.RelativeTimeFormat;
    intl.RelativeTimeFormat = vi.fn(function () {
      throw new Error('unsupported');
    });

    const date = new Date('2026-01-01T00:00:00Z');
    expect(formatRelativeTime(date, makeHass('en'))).toBe(date.toLocaleString('en'));

    intl.RelativeTimeFormat = original;
  });
});

describe('fireEvent', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches a bubbling, composed CustomEvent carrying the detail payload', () => {
    const node = document.createElement('div');
    document.body.appendChild(node);
    const handler = vi.fn();
    document.body.addEventListener('my-event', handler);

    fireEvent(node, 'my-event', { foo: 1 });

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ foo: 1 });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.cancelable).toBe(false);
  });

  it('allows overriding the default event options', () => {
    const node = document.createElement('div');
    const handler = vi.fn();
    node.addEventListener('my-event', handler);

    fireEvent(node, 'my-event', undefined, { cancelable: true });

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.cancelable).toBe(true);
  });
});
