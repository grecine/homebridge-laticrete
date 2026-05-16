<p align="center">

<img src="branding/laticrete_logo.png" width="300">

</p>

<p align="center">
<a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins"><img src="https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge" alt="verified-by-homebridge"></a>
<br>
<a href="https://www.npmjs.com/package/homebridge-mystrataheat"><img src="https://img.shields.io/npm/v/homebridge-mystrataheat?style=for-the-badge" alt="npm version"></a>
<a href="https://www.npmjs.com/package/homebridge-mystrataheat"><img src="https://img.shields.io/npm/dt/homebridge-mystrataheat?style=for-the-badge" alt="npm downloads"></a>
<a href="https://github.com/aziz66/homebridge-laticrete/stargazers"><img src="https://img.shields.io/github/stars/aziz66/homebridge-laticrete?style=for-the-badge" alt="GitHub stars"></a>
<br>
<a href="https://github.com/aziz66/homebridge-laticrete/issues"><img src="https://img.shields.io/github/issues/aziz66/homebridge-laticrete?style=for-the-badge" alt="GitHub issues"></a>
<a href="https://github.com/aziz66/homebridge-laticrete"><img src="https://img.shields.io/github/last-commit/aziz66/homebridge-laticrete?style=for-the-badge" alt="GitHub last commit"></a>
<a href="https://github.com/aziz66/homebridge-laticrete/releases"><img src="https://img.shields.io/github/v/release/aziz66/homebridge-laticrete?style=for-the-badge" alt="GitHub release"></a>
<br>
<a href="https://www.npmjs.com/package/homebridge-mystrataheat"><img src="https://img.shields.io/node/v/homebridge-mystrataheat?style=for-the-badge" alt="Node.js version"></a>
<a href="https://www.npmjs.com/package/homebridge-mystrataheat"><img src="https://img.shields.io/npm/l/homebridge-mystrataheat?style=for-the-badge" alt="license"></a>
<a href="https://ko-fi.com/aziz66"><img src="https://img.shields.io/badge/Ko--fi-Support%20Me-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-fi"></a>
</p>

# MyStrataHeat Homebridge Plugin

Connects your Laticrete MyStrataHeat / Warmup Wi-Fi thermostats to Apple HomeKit through Homebridge. Uses the comprehensive Warmup API to automatically discover your devices, control heating modes, read multiple temperature probes, and log historical energy consumption natively in the Eve app.

## Features

- **Automatic Device Discovery** — Automatically detects all locations and thermostats attached to your account.
- **Multiple Temperature Probes** — Exposes the internal Air sensor and dual Floor sensors as standalone Apple Home accessories for advanced automations.
- **Primary Sensor Control** — Choose whether the main thermostat dial represents the Air or Floor temperature.
- **Smart Override Handling** — Automatically handles temporary target temperature holds without disrupting your overall thermostat schedule.
- **Eve Graphing History** — Comprehensive charting for your temperature changes, active heating cycles, and instantaneous/total power consumption using `fakegato-history`.
- **Homebridge 2.0 Ready** — Built from the ground up to support the latest Homebridge standards.

## Supported Devices

The plugin automatically maps Laticrete / Warmup thermostat capabilities to HomeKit accessories:

| Component | What's exposed in HomeKit |
|---|---|
| **Thermostat** | Target Temperature, Current Temperature, Heating State (Off/Heat/Auto) |
| **Air Sensor** | Ambient internal air temperature (Optional standalone sensor) |
| **Floor Sensor 1** | Primary wired floor temperature probe (Optional standalone sensor) |
| **Floor Sensor 2** | Secondary wired floor temperature probe (Optional standalone sensor) |
| **Eve History** | Thermostat target vs actual graphing, valve position, and energy consumption |

## Quick Start

1. **Install the plugin** in the Homebridge UI: search for `homebridge-mystrataheat` in the Plugins tab and click Install.
2. **Configure Credentials:** Open the plugin settings and enter the Email and Password you use for the MyStrataHeat app.
3. **Customize Sensors:** Toggle on any extra Floor/Air sensors you want to see, and enable Eve Logging if you use the Eve app.
4. **Restart Homebridge** — your thermostats will appear in HomeKit!

## Configuration

All configuration is done through the Homebridge UI graphical settings menu. 
Available options include setting the polling refresh interval, adjusting the default duration for temporary temperature overrides, toggling visibility for the physical probes, and enabling Eve history.

## Troubleshooting & Help

- **Bug reports and feature requests**: [GitHub Issues](https://github.com/aziz66/homebridge-laticrete/issues)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and detailed release notes.
