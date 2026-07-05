"""Constants for the Earthquake List integration."""

DOMAIN = "earthquakelist"

CONF_GEO_TYPE = "geo_type"
CONF_GEO_ID = "geo_id"
CONF_PLACE = "place"
CONF_COUNTRY_CODE = "country_code"
CONF_MIN_MAGNITUDE = "min_magnitude"
CONF_MAX_DISTANCE = "max_distance"

BASE_URL = "https://earthquakelist.org/"
API_URL = "https://api.earthquakelist.org/"
DEFAULT_USER_AGENT = "HomeAssistant earthquakelist integration"

DEFAULT_ORDER = "latest"
DEFAULT_MIN_MAGNITUDE = 3.0
DEFAULT_MAX_DISTANCE = 50
DEFAULT_HISTORY_LIMIT = 10
