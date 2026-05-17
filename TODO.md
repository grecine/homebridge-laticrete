# MyStrataHeat Plugin - Future Enhancements / TODO

The plugin currently implements the core Thermostat logic, extra Temperature Sensors (Air, Floor 1, Floor 2), and Eve History Logging (Thermo, Energy).

Below is a comprehensive list of all remaining unmapped capabilities available via the Warmup/Laticrete API, and how they could be exposed in Homebridge in the future.

## 1. Preset Mode Switches
The API stores predefined comfort temperatures. Instead of manually turning the thermostat dial to a specific number, these could be exposed as quick-action switches in HomeKit.
- [ ] **Away Mode Switch:** Expose a standard HomeKit `Switch` that, when toggled, sets the target temperature to the `awayTemp` API value.
- [ ] **Comfort Mode Switch:** Expose a `Switch` that sets the target temperature to the `comfortTemp` API value.
- [ ] **Sleep Mode Switch:** Expose a `Switch` that sets the target temperature to the `sleepTemp` API value.

## 2. Holiday / Vacation Mode
While we currently map the HomeKit "OFF" state to the API's frost protection, we could separate this.
- [ ] **Holiday Mode Switch:** Add a dedicated `Switch` accessory to toggle true Vacation Mode on/off.

## 3. Extra Device Status Information
There are several background data points the thermostat uses that we could expose as custom characteristics (primarily for the Eve app, as Apple Home does not support them natively).
- [ ] **Heating Target Indicator:** Expose `heatingTarget` to show whether the `floor` or `air` sensor is currently dictating the heating logic.
- [ ] **Override Duration Display:** Expose `overrideDur` to display exactly how many minutes are remaining on the active temporary override. (Could be exposed as a custom characteristic, or hacked into HomeKit using a `BatteryLevel` 0-100% characteristic).
- [ ] **Safety Limits:** Expose `minTemp` and `maxTemp` as viewable characteristics so users can see the safety thresholds set on the physical device.

## 4. Potential Code Cleanup / Refactoring
- [x] Migrate the API calls from the current `REST` endpoints to the `GraphQL` endpoint (`https://apil.warmup.com/graphql`) if any of the above fields (like `heatingTarget`) are not present in the current REST payload.
- [x] Implement caching to prevent rate-limiting if multiple accessories are polling simultaneously. (Solved architecturally by migrating to central push-based polling).
