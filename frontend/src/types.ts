export interface HassDevice {
  id: string;
  name: string;
  integration?: string;
  name_by_user?: string;
}

export interface FrontendLocaleData {
  language: string;
  number_format: 'comma_decimal' | 'decimal_comma' | 'space_comma' | 'system';
  time_format: '12' | '24' | 'system' | 'am_pm';
}

// A basic representation of the Home Assistant object
export interface HomeAssistant {
  states: { [entity_id: string]: HassEntity };
  entities: { [entity_id: string]: HassEntityRegistryDisplayEntry };
  devices: { [deviceId: string]: HassDevice };
  localize: (key: string, ...args: unknown[]) => string;
  language: string;
  locale: FrontendLocaleData;
  callWS: <T>(message: { type: string; [key: string]: unknown }) => Promise<T>;
  themes?: {
    darkMode?: boolean;
    [key: string]: unknown;
  };
}

export interface EarthquakeListItem {
  id?: string;
  magnitude?: number;
  time?: string;
  place?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  depth_km?: number;
  distance_km?: number;
  direction?: string;
  alert_level?: string;
  alert_tsunami?: boolean;
}

export interface EarthquakeSensorAttributes {
  friendly_name?: string;
  place?: string;
  location?: string;
  time?: string;
  depth_km?: number;
  distance_km?: number;
  direction?: string;
  latitude?: number;
  longitude?: number;
  alert_level?: string;
  alert_tsunami?: boolean;
  mmi?: number;
  felt?: number;
  significance?: number;
  usgs_code?: string;
  news_link?: string;
  monitored_place?: string;
  min_magnitude?: number;
  max_distance?: number;
  earthquakes?: EarthquakeListItem[];
  [key: string]: unknown;
}

// A basic representation of a Home Assistant entity state object
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: EarthquakeSensorAttributes;
  last_changed: string;
  last_updated: string;
}

export interface HassEntityRegistryDisplayEntry {
  entity_id: string;
  display_precision?: number;
  device_id?: string;
  domain?: string;
  platform?: string;
}

// A basic representation of a Lovelace card
export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  editMode?: boolean;
  setConfig(config: LovelaceCardConfig): void;
  getCardSize?(): number | Promise<number>;
}

// A basic representation of a Lovelace card configuration
export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

// A suggestion returned by a custom card's getEntitySuggestion for the card picker (HA 2026.6+)
export interface EntityCardSuggestion {
  config: LovelaceCardConfig;
  label?: string;
}

export interface EarthquakeListCardConfig extends LovelaceCardConfig {
  places: string[];
  title?: string;
  show_map?: boolean;
  show_list?: boolean;
  max_list_items?: number;
}

declare global {
  interface Window {
    customCards?: Array<{
      type: string;
      name: string;
      description: string;
      preview?: boolean;
      documentationURL?: string;
      getEntitySuggestion?: (
        hass: HomeAssistant,
        entityId: string,
      ) => EntityCardSuggestion | EntityCardSuggestion[] | null;
    }>;
  }
}
