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

## Provided Entity

Each configured location gets a single `sensor.earthquakelist_<location>_latest_earthquake` entity:

- **State**: Magnitude of the latest earthquake matching the configured filter.
- **Attributes**: `place`, `location`, `time`, `depth_km`, `distance_km`, `direction`, `latitude`, `longitude`, `alert_level`, `alert_tsunami`, `mmi`, `felt`, `significance`, `usgs_code`, `news_link`, `monitored_place`, `min_magnitude`, `max_distance`, `earthquakes` (list of up to 10 recent matches, used by the card).

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

## Data Source

All data is provided by the public API behind [earthquakelist.org](https://earthquakelist.org). This integration is not affiliated with earthquakelist.org.
