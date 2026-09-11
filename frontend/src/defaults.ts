import { EarthquakeListCardConfig } from './types';

// The single source of truth for the card's defaults.
//
// The editor used to keep a hand-copied second table and only a comment held the
// two in step. That mattered because the editor strips any value that equals a
// default before saving: while the tables agree that is behaviour-neutral (the
// card puts the same value back), but the moment one of them moved, every
// dashboard the editor had touched silently changed behaviour. Both sides now
// read this object, and defaults.test.ts asserts they still do.
export const CARD_DEFAULTS = {
  show_map: true,
  show_list: true,
  max_list_items: 5,
  // Defaults to every earthquake the sensor provides (DEFAULT_HISTORY_LIMIT in
  // const.py), which is deliberately more than the list shows: the map has room
  // for surrounding context. Set it lower (or to max_list_items + 1) to keep the
  // two in step.
  max_map_markers: 10,
  // `auto` prefers Home Assistant's own `map_tiles` proxy when that integration is loaded and
  // falls back to OpenFreeMap otherwise; `core` and `openfreemap` force one or the other.
  map_tile_source: 'auto',
  // `auto` follows Home Assistant's own light/dark theme; `light` and `dark` pin the map
  // regardless of it, for dashboards that stay on one look.
  map_theme_mode: 'auto',
} as const satisfies Partial<EarthquakeListCardConfig>;

// The sensor never returns more than this, so the editor's selector stops here.
export const MAX_MAP_MARKERS_LIMIT = CARD_DEFAULTS.max_map_markers;
