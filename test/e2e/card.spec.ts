import { test, expect } from './fixtures/hass';
import { removeState, setState, useDashboard } from './helpers/homeassistant';

const ENTITY = 'sensor.e2e_card_earthquakes';
const MISSING_ENTITY = 'sensor.e2e_card_not_here';

/**
 * Mirrors what sensor.py's `_earthquake_to_dict` puts on the entity. Writing
 * the real shape here is the point of an end-to-end test: an invented one would
 * have passed while the card showed nothing.
 */
const EARTHQUAKE = {
  id: 'e2e-1',
  magnitude: 5.6,
  time: new Date().toISOString(),
  place: 'Nowhere',
  location: '11 km SE of Nowhere',
  latitude: 39.6,
  longitude: 20.1,
  depth_km: 10,
  distance_km: 42,
  direction: 'SE',
  alert_level: null, // parser.py normalises the API's false to None
  alert_tsunami: false,
  offshore: false,
};

const DASHBOARD = {
  views: [
    {
      title: 'Quakes',
      cards: [{ type: 'custom:earthquakelist-card', places: [ENTITY], title: 'E2E quakes' }],
    },
    { title: 'Elsewhere', cards: [{ type: 'markdown', content: 'nothing here' }] },
    {
      title: 'Typo',
      cards: [{ type: 'custom:earthquakelist-card', places: [MISSING_ENTITY], title: 'E2E typo' }],
    },
  ],
};

let urlPath: string;

test.beforeAll(async () => {
  await setState(ENTITY, String(EARTHQUAKE.magnitude), {
    friendly_name: 'E2E quakes',
    unit_of_measurement: 'M',
    earthquakes: [EARTHQUAKE],
  });
  urlPath = await useDashboard('card', DASHBOARD);
});

test.afterAll(async () => {
  await removeState(ENTITY);
});

test.describe('The card on a real dashboard', () => {
  test('renders the earthquake the sensor reports', async ({ page, consoleErrors }) => {
    await page.goto(`/${urlPath}/0`);

    // Assert on what the card paints, not on the custom element itself: the host
    // has no box of its own, so Playwright rightly calls it hidden.
    const card = page.locator('earthquakelist-card');
    await expect(card.locator('ha-card')).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('.summary-location')).toHaveText('Nowhere');
    await expect(card.locator('.magnitude-badge')).toHaveText('5.6');
    expect(consoleErrors).toEqual([]);
  });

  test('renders its map', async ({ page }) => {
    await page.goto(`/${urlPath}/0`);
    await expect(page.locator('earthquakelist-map .map-container')).toBeVisible({
      timeout: 60_000,
    });
  });

  test('names an entity that does not exist instead of reporting no data', async ({ page }) => {
    // The three ways a place can render nothing - entity gone, sensor unavailable,
    // nothing matched - used to be one and the same message, so a typo in the
    // dashboard config was indistinguishable from a quiet region.
    await page.goto(`/${urlPath}/2`);

    const empty = page.locator('earthquakelist-card').locator('.empty-state');
    await expect(empty).toBeVisible({ timeout: 60_000 });
    await expect(empty).toContainText(MISSING_ENTITY);
    await expect(empty).not.toContainText('No earthquake data yet');
  });

  test('comes back after leaving the view and returning', async ({ page }) => {
    // Views are torn out of the DOM on a switch. A card that does not notice it
    // is visible again comes back empty - that is how the streaming card in
    // skyline-webcams failed, and no unit test saw it.
    await page.goto(`/${urlPath}/0`);
    const location = page.locator('earthquakelist-card').locator('.summary-location');
    await expect(location).toHaveText('Nowhere', { timeout: 60_000 });

    await page.getByRole('tab', { name: 'Elsewhere' }).click();
    await expect(page.locator('earthquakelist-card')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Quakes' }).click();
    await expect(location).toHaveText('Nowhere', { timeout: 30_000 });
  });
});
