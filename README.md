# Earthquake List Integration for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg?style=flat-square)](https://github.com/hacs/integration)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/timmaurice/earthquakelist?style=flat-square)
[![GH-downloads](https://img.shields.io/github/downloads/timmaurice/earthquakelist/total?style=flat-square)](https://github.com/timmaurice/earthquakelist/releases)
[![GH-last-commit](https://img.shields.io/github/last-commit/timmaurice/earthquakelist.svg?style=flat-square)](https://github.com/timmaurice/earthquakelist/commits/main)
[![GH-code-size](https://img.shields.io/github/languages/code-size/timmaurice/earthquakelist.svg?style=flat-square)](https://github.com/timmaurice/earthquakelist)
![GitHub](https://img.shields.io/github/license/timmaurice/earthquakelist?style=flat-square)

This custom integration for Home Assistant fetches earthquake data directly from [earthquakelist.org](https://earthquakelist.org). **It comes bundled with a Lovelace card** to visualize it — no separate frontend install needed.

<img src="https://raw.githubusercontent.com/timmaurice/earthquakelist/main/docs/card-screenshot.png" alt="Earthquake List Lovelace card showing a magnitude badge, map, and recent-earthquakes list for Japan" width="420">

## Features

- **Global Coverage**: Monitor any place, region or country listed on earthquakelist.org.
- **Configurable Filter**: Set a minimum magnitude and maximum distance to determine which earthquakes match.
- **Detailed Attributes**: Location, time, depth, distance & direction from the monitored point, tsunami alert, felt reports, Mercalli intensity, significance, the USGS reference code, and up to 10 recent matching earthquakes.
- **Device per Location**: Creates a dedicated device in Home Assistant for each monitored location.
- **Bundled Lovelace Card**: Magnitude badge, tsunami alert badge, a Leaflet map with magnitude-colored markers, and a recent-earthquakes list — configurable per place via a GUI editor.
- **Localization**: Supports English and German out of the box.

## Localization

Both the integration (config flow, entity names) and the Lovelace card are available in the following languages:

- English
- German

<details>
<summary>Contributing Translations</summary>

This repo has two separate translation sets, both need updating for a new language:

1.  **Integration** (config flow, entity names): in `custom_components/earthquakelist/translations`, copy `en.json` and rename it to your language code (e.g., `fr.json` for French). Home Assistant picks up new translation files automatically — no code changes needed.
2.  **Lovelace card** (editor, card UI): in `frontend/src/translation`, copy `en.json` and rename it to your language code, then import the new file in `frontend/src/localize.ts` and add it to the `translations` object.

Translate all the values in both new files and submit a pull request with your changes.

</details>

## Installation

### HACS (Recommended)

This integration is available in the [Home Assistant Community Store (HACS)](https://hacs.xyz/).

<a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=timmaurice&repository=earthquakelist&category=integration" target="_blank" rel="noreferrer noopener"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open your Home Assistant instance and open a repository inside the Home Assistant Community Store." /></a>

<details>
<summary>Manual Installation</summary>

1.  Using the tool of your choice, copy the `earthquakelist` folder from `custom_components` in this repository into your Home Assistant's `custom_components` directory.
2.  Restart Home Assistant.

</details>

## Configuration

Configuration is done entirely through the Home Assistant UI:

1.  Navigate to **Settings > Devices & Services**.
2.  Click **Add Integration** and search for "Earthquake List".
3.  Search for the place, region or country you want to monitor and select it from the results.
4.  Set the minimum magnitude and maximum distance (in km) used to determine the latest matching earthquake.

These filter values can be changed at any time via the integration's **Configure** option.

## Created Sensors

For each configured location, a device with the following sensor is created (entity ID `sensor.earthquakelist_<location>_latest_earthquake`):

| Sensor                | Description                                                        | Attributes                                                                                                                                                                                                                                                                                                   | Example Value |
| :-------------------- | :----------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ |
| **Latest Earthquake** | Magnitude of the latest earthquake matching the configured filter. | `place`, `location`, `time`, `depth_km`, `distance_km`, `direction`, `latitude`, `longitude`, `alert_level`, `alert_tsunami`, `mmi`, `felt`, `significance`, `usgs_code`, `news_link`, `monitored_place`, `min_magnitude`, `max_distance`, `earthquakes` (list of up to 10 recent matches, used by the card) | `3.5`         |

## Lovelace Card

Add a card to any dashboard and select **Earthquake List Card**, or add it via YAML:

```yaml
type: custom:earthquakelist-card
title: Monitored Earthquakes
show_map: true
show_list: true
max_list_items: 5
places:
  - sensor.earthquakelist_corfu_latest_earthquake
  - sensor.earthquakelist_japan_latest_earthquake
```

| Option           | Type       | Default | Description                                                  |
| ---------------- | ---------- | ------- | ------------------------------------------------------------ |
| `places`         | `string[]` | —       | Required. One `sensor.earthquakelist_*` entity per place.    |
| `title`          | `string`   | —       | Optional card title.                                         |
| `show_map`       | `boolean`  | `true`  | Show the Leaflet map with magnitude-colored markers.         |
| `show_list`      | `boolean`  | `true`  | Show the recent-earthquakes list below the map.              |
| `max_list_items` | `number`   | `5`     | Max. number of entries shown in the recent earthquakes list. |

## Notifications

An [automation blueprint](blueprints/automation/timmaurice/earthquake_notify.yaml) is included to notify you whenever a monitored location reports a new earthquake, without writing any YAML. It triggers on a genuinely new match (not just a re-poll with the same result) and optionally lets you require a higher minimum magnitude or restrict to tsunami/impact alerts only.

<a href="https://my.home-assistant.io/redirect/blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Ftimmaurice%2Fearthquakelist%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Ftimmaurice%2Fearthquake_notify.yaml" target="_blank" rel="noreferrer noopener"><img src="https://my.home-assistant.io/badges/blueprint_import.svg" alt="Open your Home Assistant instance and show the blueprint import dialog with a specific blueprint pre-filled." /></a>

## Data Source

All data is provided by the public API behind [earthquakelist.org](https://earthquakelist.org). This integration is not affiliated with earthquakelist.org. Each configured location polls independently every 15 minutes.

## Development

<details>
<summary>To contribute to the development, you'll need to set up a build environment.</summary>

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/timmaurice/earthquakelist.git
    cd earthquakelist
    ```

2.  **Install dependencies:**

    ```bash
    pip install -r requirements.txt -r requirements-test.txt
    npm ci
    ```

3.  **Run the backend tests:**

    ```bash
    PYTHONPATH=. pytest custom_components/earthquakelist/tests
    ```

4.  **Build the frontend card:**
    This command compiles `frontend/src/earthquakelist-card.ts` into `custom_components/earthquakelist/earthquakelist-card.js`.

    ```bash
    npm run build
    ```

### Local Testing with Docker

To test your changes against a real Home Assistant instance without touching your production setup:

1.  Run `docker compose up -d` to start a local Home Assistant container with this integration mounted.
2.  Access Home Assistant at [http://localhost:8136](http://localhost:8136) (login `admin` / `password`) and complete onboarding if this is the first run.
3.  Add the "Earthquake List" integration and the `earthquakelist-card` to a dashboard to verify your changes.
4.  After editing Python files under `custom_components/earthquakelist/`, run `docker restart ha-earthquakelist-test` to pick up the changes (no rebuild needed).
5.  After editing frontend files, run `npm run build` first, then restart the container the same way.

When you're done, run `docker compose down` to stop the environment. Your configuration persists in the `config/` folder between runs.

</details>

## Contributions

Contributions are welcome! If you find a bug or have a feature request, please open an issue on the GitHub repository.

---

For further assistance or to [report issues](https://github.com/timmaurice/earthquakelist/issues), please visit the [GitHub repository](https://github.com/timmaurice/earthquakelist).

![Star History Chart](https://api.star-history.com/svg?repos=timmaurice/earthquakelist&type=Date)

## ☕ Support My Work

[<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="30" />](https://www.buymeacoffee.com/timmaurice)
