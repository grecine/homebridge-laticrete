# Changelog

All notable changes to this project will be documented in this file.

## [0.0.9] - 2024-05-15
### Added
- Eve app historical logging via `fakegato-history`.
- Eve Temperature History (tracks current vs target temp, and heating state).
- Eve Energy History (tracks current and total consumption in Watts/kWh).
- Added Custom Eve Characteristics for Current Consumption and Total Consumption to the main thermostat service.
- Added Homebridge 2.0 Compatibility (`engines.homebridge` updated).

## [0.0.8] - 2024-05-15
### Added
- Feature to select a "Primary Thermostat Sensor" via plugin configuration (defaults to `currentTemp`, allows selecting `airTemp` or `floorTemp`).

## [0.0.6] - 2024-05-15
### Added
- Integration with Warmup's comprehensive GraphQL API.
- Support for internal Air Temperature sensor and two wired Floor Temperature probes.
- Added GUI configuration toggles to expose Air and Floor probes as separate HomeKit Temperature Sensors.
- Complete mode mapping for OFF/HEAT/AUTO with proper manual fixed temperature override support.

## [0.0.1] - Initial Beta
### Added
- Initial REST API wrapper and device discovery for MyStrataHeat/Warmup thermostats.
- Basic target temperature and heating status mapping.
