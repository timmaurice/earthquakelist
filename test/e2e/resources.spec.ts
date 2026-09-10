import { test, expect } from './fixtures/hass';
import { resources, useDashboard } from './helpers/homeassistant';

const CARD_PREFIX = '/earthquakelist_frontend/';

test.describe('Lovelace resource registration', () => {
  test('has exactly one resource for the bundled card', async () => {
    // The registration used to append a resource on every restart. A unit test
    // cannot see that: it needs the store Home Assistant actually persisted.
    const ours = (await resources()).filter((resource) => resource.url.startsWith(CARD_PREFIX));

    expect(ours).toHaveLength(1);
    expect(ours[0].url).toMatch(/^\/earthquakelist_frontend\/earthquakelist-card\.js\?v=/);
  });

  test('serves the bundle and defines its elements without a clash', async ({ page, consoleErrors }) => {
    const urlPath = await useDashboard('resources', {
      views: [{ title: 'Empty', cards: [] }],
    });

    await page.goto(`/${urlPath}/0`);
    await page.waitForFunction(() => customElements.get('earthquakelist-card') !== undefined, {
      timeout: 60_000,
    });
    await expect.poll(() => page.evaluate(() => !!customElements.get('earthquakelist-map'))).toBe(true);

    // A bundle loaded twice used to throw on the second define().
    expect(consoleErrors.filter((text) => /has already been used/i.test(text))).toEqual([]);
  });
});
