import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { MyStrataHeatPlatform } from './platform';
import { NormalizedRoom } from './mystrataheat-api';

/**
 * MyStrataHeatAccessory
 *
 * One instance per room. State is pushed in via updateStatusWithRoom()
 * by the platform's central poll loop — there is no per-accessory timer.
 */
export class MyStrataHeatAccessory {
  private service: Service;
  private airTempService?: Service;
  private floor1TempService?: Service;
  private floor2TempService?: Service;

  private thermoHistoryService?: any;
  private energyHistoryService?: any;

  constructor(
    private readonly platform: MyStrataHeatPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Laticrete')
      .setCharacteristic(this.platform.Characteristic.Model, 'MyStrataHeat Thermostat')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        accessory.context.device.roomId?.toString() ?? 'unknown',
      );

    // Get or create the Thermostat service
    this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.roomName);

    // Current heating state — read-only, updated on poll
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    // Target heating state — Off / Heat / Auto (no Cool)
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO,
        ],
      })
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    // Current temperature — read-only, updated on poll
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    // Target temperature — setProps with real hardware limits applied in
    // updateStatusWithRoom() once live data arrives. Defaults here are wide
    // so HomeKit doesn't clamp values on cached accessories before first poll.
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({ minValue: 0, maxValue: 35 })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    // Optional Air Temperature Sensor
    if (this.platform.config.showAirTemp) {
      this.airTempService =
        this.accessory.getService('Air Temperature') ||
        this.accessory.addService(this.platform.Service.TemperatureSensor, 'Air Temperature', 'air-temp');
      this.airTempService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -100, maxValue: 100 })
        .onGet(() => (this.accessory.context.device.airTemp ?? 0) / 10);
    } else {
      const existing = this.accessory.getService('Air Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // Optional Floor 1 Temperature Sensor
    if (this.platform.config.showFloor1Temp) {
      this.floor1TempService =
        this.accessory.getService('Floor 1 Temperature') ||
        this.accessory.addService(this.platform.Service.TemperatureSensor, 'Floor 1 Temperature', 'floor1-temp');
      this.floor1TempService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -100, maxValue: 100 })
        .onGet(() => (this.accessory.context.device.floor1Temp ?? 0) / 10);
    } else {
      const existing = this.accessory.getService('Floor 1 Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // Optional Floor 2 Temperature Sensor
    if (this.platform.config.showFloor2Temp) {
      this.floor2TempService =
        this.accessory.getService('Floor 2 Temperature') ||
        this.accessory.addService(this.platform.Service.TemperatureSensor, 'Floor 2 Temperature', 'floor2-temp');
      this.floor2TempService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .setProps({ minValue: -100, maxValue: 100 })
        .onGet(() => (this.accessory.context.device.floor2Temp ?? 0) / 10);
    } else {
      const existing = this.accessory.getService('Floor 2 Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // Eve Thermo History (temperature + heating state over time)
    if (this.platform.config.enableEveThermoLogging) {
      this.thermoHistoryService = new this.platform.FakeGatoHistoryService('thermo', this.accessory, {
        log: this.platform.log,
        filename: `fakegato-thermo-${accessory.context.device.roomId}.json`,
      });
    }

    // Eve Energy History (power consumption over time)
    if (this.platform.config.enableEveEnergyLogging) {
      if (!this.service.testCharacteristic(this.platform.eveCharacteristics.CurrentConsumption)) {
        this.service.addCharacteristic(this.platform.eveCharacteristics.CurrentConsumption);
      }
      if (!this.service.testCharacteristic(this.platform.eveCharacteristics.TotalConsumption)) {
        this.service.addCharacteristic(this.platform.eveCharacteristics.TotalConsumption);
      }

      this.energyHistoryService = new this.platform.FakeGatoHistoryService('energy', this.accessory, {
        log: this.platform.log,
        filename: `fakegato-energy-${accessory.context.device.roomId}.json`,
      });
    }
  }

  /**
   * Called by the platform's central poll loop (and immediately after
   * discovery) with fresh room data. Updates all characteristics and history.
   */
  updateStatusWithRoom(room: NormalizedRoom) {
    // Keep context in sync so onGet handlers return fresh values.
    this.accessory.context.device = room;

    // Apply real hardware temperature limits now that we have live data.
    // Done here rather than in the constructor so cached accessories get real
    // limits on the first push, not stale defaults from the cached context.
    if (room.minTemp && room.maxTemp) {
      this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature).setProps({
        minValue: room.minTemp / 10,
        maxValue: room.maxTemp / 10,
      });
    }

    // --- Determine current heating state ---
    let currentState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    if (room.runMode === 'off') {
      currentState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else if (typeof room.outputStatus === 'number') {
      // Relay state from thermostat4ies.parameters.outputStatus is the most
      // accurate signal — non-zero means the relay is closed (actively heating).
      currentState =
        room.outputStatus !== 0
          ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else {
      // Fallback: heuristic when outputStatus is unavailable
      currentState =
        room.currentTemp < room.targetTemp
          ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
          : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }

    // --- Primary temperature sensor ---
    const primarySensor = (this.platform.config.primarySensor as string) || 'currentTemp';
    const rawCurrentTemp: number =
      room[primarySensor as keyof NormalizedRoom] !== undefined
        ? (room[primarySensor as keyof NormalizedRoom] as number)
        : room.currentTemp;
    const currentTempC = rawCurrentTemp / 10;

    // --- Push all characteristics ---
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, currentTempC);
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, room.targetTemp / 10);
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState, currentState);
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeatingCoolingState,
      this.deriveTargetHeatingState(room),
    );

    // --- Optional temperature sensors ---
    if (this.airTempService) {
      this.airTempService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, room.airTemp / 10);
    }
    if (this.floor1TempService) {
      this.floor1TempService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        room.floor1Temp / 10,
      );
    }
    if (this.floor2TempService) {
      this.floor2TempService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        room.floor2Temp / 10,
      );
    }

    // --- Eve history ---
    const now = Math.round(Date.now() / 1000);

    if (this.thermoHistoryService) {
      this.thermoHistoryService.addEntry({
        time: now,
        currentTemp: currentTempC,
        setTemp: room.targetTemp / 10,
        valvePosition: currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT ? 100 : 0,
      });
    }

    if (this.platform.config.enableEveEnergyLogging) {
      // Use `energy` (string, daily kWh) as the cumulative total.
      // `total` is available from GraphQL but its units are unconfirmed —
      // defer switching until validated with a real active heating session.
      const totalEnergy = parseFloat(room.energy || '0');
      // Instantaneous power: synthesized from relay state (1000W when on).
      // The API does not expose actual wattage.
      const powerW = currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT ? 1000 : 0;

      this.service.updateCharacteristic(this.platform.eveCharacteristics.CurrentConsumption, powerW);
      this.service.updateCharacteristic(this.platform.eveCharacteristics.TotalConsumption, totalEnergy);

      if (this.energyHistoryService) {
        this.energyHistoryService.addEntry({ time: now, power: powerW });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State derivation helpers
  // ---------------------------------------------------------------------------

  /**
   * Maps GraphQL runMode to HAP TargetHeatingCoolingState.
   * runMode enum: off | schedule | override | fixed | anti_frost | holiday | gradual | ...
   */
  private deriveTargetHeatingState(room: NormalizedRoom): CharacteristicValue {
    switch (room.runMode) {
      case 'off':
      case 'holiday':
      case 'anti_frost':
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      case 'schedule':
      case 'gradual':
        return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
      case 'fixed':
      case 'override':
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
      default:
        this.platform.log.warn(
          `[${this.accessory.displayName}] Unknown runMode: "${room.runMode}" — defaulting to HEAT`,
        );
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }
  }

  // ---------------------------------------------------------------------------
  // onGet handlers — read from cached context for instant HomeKit response
  // ---------------------------------------------------------------------------

  handleCurrentHeatingCoolingStateGet(): CharacteristicValue {
    const room: NormalizedRoom = this.accessory.context.device;
    if (room.runMode === 'off') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
    if (typeof room.outputStatus === 'number') {
      return room.outputStatus !== 0
        ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
        : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
    return room.currentTemp < room.targetTemp
      ? this.platform.Characteristic.CurrentHeatingCoolingState.HEAT
      : this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  handleTargetHeatingCoolingStateGet(): CharacteristicValue {
    return this.deriveTargetHeatingState(this.accessory.context.device);
  }

  handleCurrentTemperatureGet(): CharacteristicValue {
    const room: NormalizedRoom = this.accessory.context.device;
    const primarySensor = (this.platform.config.primarySensor as string) || 'currentTemp';
    const raw: number =
      room[primarySensor as keyof NormalizedRoom] !== undefined
        ? (room[primarySensor as keyof NormalizedRoom] as number)
        : room.currentTemp;
    return raw / 10;
  }

  handleTargetTemperatureGet(): CharacteristicValue {
    return this.accessory.context.device.targetTemp / 10;
  }

  // ---------------------------------------------------------------------------
  // onSet handlers
  // ---------------------------------------------------------------------------

  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    const room: NormalizedRoom = this.accessory.context.device;
    const roomId = room.roomId;

    try {
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
        // Per-room off — does NOT affect other rooms (unlike old setModes).
        await this.platform.mystrataheatApi.setRoomOff(roomId);
      } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        await this.platform.mystrataheatApi.setRoomAuto(roomId);
      } else {
        // HEAT: set a temporary override. If the device is off or in frost/holiday
        // mode, targetTemp is meaningless — fall back to fixedTemp or 21°C.
        let targetC = room.targetTemp / 10;
        if (room.runMode === 'off' || room.runMode === 'anti_frost' || room.runMode === 'holiday' || targetC === 0) {
          targetC = (room.fixedTemp || 0) / 10 || 21;
        }
        const duration = (this.platform.config.duration as number) || 60;
        await this.platform.mystrataheatApi.setTargetTemperature(roomId, targetC, duration);
      }
    } catch (error) {
      this.platform.log.error(`[${this.accessory.displayName}] Failed to set target state:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async handleTargetTemperatureSet(value: CharacteristicValue) {
    const roomId = this.accessory.context.device.roomId;
    try {
      const duration = (this.platform.config.duration as number) || 60;
      await this.platform.mystrataheatApi.setTargetTemperature(roomId, value as number, duration);
    } catch (error) {
      this.platform.log.error(`[${this.accessory.displayName}] Failed to set target temperature:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  handleTemperatureDisplayUnitsGet(): CharacteristicValue {
    return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  }

  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Set TemperatureDisplayUnits:', value);
  }
}
