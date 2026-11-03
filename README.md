# Enclave releases

Installers for Enclave for Windows (beta) are under [Releases](../../releases).

The release `location-database` holds the IP address to location data the app uses to match a profile's time zone and location to its proxy. A monthly workflow refreshes it from [daijro/geoip-all-in-one](https://github.com/daijro/geoip-all-in-one) after checking it, and the app downloads it by itself.
