import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { MyStrataHeatPlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
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

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Laticrete')
      .setCharacteristic(this.platform.Characteristic.Model, 'MyStrataHeat Thermostat')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.roomId.toString());

    // get the Thermostat service if it exists, otherwise create a new Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.roomName);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
      
    // Set valid values for Target Heating Cooling State (Off, Heat, Auto)
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeatingCoolingState.OFF,
          this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
          this.platform.Characteristic.TargetHeatingCoolingState.AUTO
        ]
      });

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .setProps({
        minValue: 0,
      })
      .onGet(this.handleTargetTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    // Optional Air Temperature Sensor
    if (this.platform.config.showAirTemp) {
      this.airTempService = this.accessory.getService('Air Temperature') || 
                            this.accessory.addService(this.platform.Service.TemperatureSensor, 'Air Temperature', 'air-temp');
      this.airTempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(() => (this.accessory.context.device.airTemp || 0) / 10);
    } else {
      const existing = this.accessory.getService('Air Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // Optional Floor 1 Temperature Sensor
    if (this.platform.config.showFloor1Temp) {
      this.floor1TempService = this.accessory.getService('Floor 1 Temperature') || 
                               this.accessory.addService(this.platform.Service.TemperatureSensor, 'Floor 1 Temperature', 'floor1-temp');
      this.floor1TempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(() => (this.accessory.context.device.floor1Temp || 0) / 10);
    } else {
      const existing = this.accessory.getService('Floor 1 Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // Optional Floor 2 Temperature Sensor
    if (this.platform.config.showFloor2Temp) {
      this.floor2TempService = this.accessory.getService('Floor 2 Temperature') || 
                               this.accessory.addService(this.platform.Service.TemperatureSensor, 'Floor 2 Temperature', 'floor2-temp');
      this.floor2TempService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(() => (this.accessory.context.device.floor2Temp || 0) / 10);
    } else {
      const existing = this.accessory.getService('Floor 2 Temperature');
      if (existing) this.accessory.removeService(existing);
    }

    // start polling for status updates
    setInterval(() => {
      this.updateStatus();
    }, (this.platform.config.refresh || 60) * 1000);

    // Initialize Eve Thermo History
    if (this.platform.config.enableEveThermoLogging) {
      this.thermoHistoryService = new this.platform.FakeGatoHistoryService('thermo', this.accessory, {
        log: this.platform.log,
        filename: `fakegato-thermo-${accessory.context.device.roomId}.json`
      });
    }

    // Initialize Eve Energy History and Characteristics
    if (this.platform.config.enableEveEnergyLogging) {
      if (!this.service.testCharacteristic(this.platform.eveCharacteristics.CurrentConsumption)) {
        this.service.addCharacteristic(this.platform.eveCharacteristics.CurrentConsumption);
      }
      if (!this.service.testCharacteristic(this.platform.eveCharacteristics.TotalConsumption)) {
        this.service.addCharacteristic(this.platform.eveCharacteristics.TotalConsumption);
      }

      this.energyHistoryService = new this.platform.FakeGatoHistoryService('energy', this.accessory, {
        log: this.platform.log,
        filename: `fakegato-energy-${accessory.context.device.roomId}.json`
      });
    }
  }
  
  async updateStatus() {
    try {
      const room = await this.platform.mystrataheatApi.getRoomStatus(this.accessory.context.device.roomId);
      if (room) {
        this.accessory.context.device = room;
        
        // Update characteristics
        const primarySensor = this.platform.config.primarySensor || 'currentTemp';
        const currentTempValue = room[primarySensor] !== undefined ? room[primarySensor] : room.currentTemp;
        
        this.service.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature, 
          currentTempValue / 10
        );
        
        this.service.updateCharacteristic(
          this.platform.Characteristic.TargetTemperature, 
          room.targetTemp / 10
        );
        
        // If current is less than target and not off, then heating
        let currentState = this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
        const isOff = room.runMode === 'off' || room.roomMode === 'off' || room.runModeInt === 0 || room.runModeInt === 4;
        if (!isOff && room.currentTemp < room.targetTemp) {
           currentState = this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
        }
        this.service.updateCharacteristic(
          this.platform.Characteristic.CurrentHeatingCoolingState, 
          currentState
        );

        if (this.airTempService && room.airTemp !== undefined) {
          this.airTempService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, room.airTemp / 10);
        }
        if (this.floor1TempService && room.floor1Temp !== undefined) {
          this.floor1TempService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, room.floor1Temp / 10);
        }
        if (this.floor2TempService && room.floor2Temp !== undefined) {
          this.floor2TempService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, room.floor2Temp / 10);
        }

        // Update Eve Characteristics and History
        const now = Math.round(new Date().valueOf() / 1000);
        
        if (this.thermoHistoryService) {
          this.thermoHistoryService.addEntry({
            time: now,
            currentTemp: currentTempValue / 10,
            setTemp: room.targetTemp / 10,
            valvePosition: currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT ? 100 : 0
          });
        }

        if (this.platform.config.enableEveEnergyLogging) {
          // Warmup API returns energy as a string or number, sometimes representing cost or actual kWh.
          // Since it's undocumented, we parse it safely. If 'energy' is missing, fallback to 0.
          // Wait, 'cost' is string, 'energy' is string. Usually 'energy' is kWh or similar.
          // We assume 'energy' is a string we can parse. If it's a daily total, we might need to calculate power.
          // Since we don't know the exact instantaneous W, we can leave CurrentConsumption at 0 if unknown,
          // or derive it. For now, we update TotalConsumption with the 'energy' value if parsed correctly.
          const totalEnergy = parseFloat(room.energy || '0');
          // For instantaneous power, if we don't have it, we set it to 0 or derive from heating target (e.g. 1000W when ON).
          const powerW = currentState === this.platform.Characteristic.CurrentHeatingCoolingState.HEAT ? 1000 : 0; 
          
          this.service.updateCharacteristic(this.platform.eveCharacteristics.CurrentConsumption, powerW);
          this.service.updateCharacteristic(this.platform.eveCharacteristics.TotalConsumption, totalEnergy);

          if (this.energyHistoryService) {
            this.energyHistoryService.addEntry({
              time: now,
              power: powerW
            });
          }
        }

      }
    } catch (error) {
      this.platform.log.error('Error updating status for', this.accessory.displayName, error);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  handleCurrentHeatingCoolingStateGet() {
    const room = this.accessory.context.device;
    const isOff = room.runMode === 'off' || room.roomMode === 'off' || room.runModeInt === 0 || room.runModeInt === 4;
    if (isOff) {
       return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    }
    if (room.currentTemp < room.targetTemp) {
       return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateGet() {
    const room = this.accessory.context.device;
    const isOff = room.runMode === 'off' || room.roomMode === 'off' || room.runModeInt === 0 || room.runModeInt === 4;
    if (isOff) {
       return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    } else if (room.roomMode === 'prog' || room.roomModeInt === 1) {
       return this.platform.Characteristic.TargetHeatingCoolingState.AUTO;
    } else {
       return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  async handleTargetHeatingCoolingStateSet(value: CharacteristicValue) {
    const roomId = this.accessory.context.device.roomId;
    try {
      if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
        await this.platform.mystrataheatApi.setRoomOff(roomId);
      } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
        await this.platform.mystrataheatApi.setRoomAuto(roomId);
      } else {
        // When turning to HEAT, use the comfort temp or default to 21C if target was 0
        let targetValue = this.accessory.context.device.targetTemp / 10;
        if (targetValue < 10) {
            targetValue = (this.accessory.context.device.comfortTemp / 10) || 21;
        }
        await this.platform.mystrataheatApi.setRoomFixed(roomId, targetValue);
      }
    } catch (error) {
      this.platform.log.error('Failed to set target state', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  handleCurrentTemperatureGet() {
    const room = this.accessory.context.device;
    const primarySensor = this.platform.config.primarySensor || 'currentTemp';
    const currentTempValue = room[primarySensor] !== undefined ? room[primarySensor] : room.currentTemp;
    
    // Current temperature in degrees Celsius
    return currentTempValue / 10;
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  handleTargetTemperatureGet() {
    return this.accessory.context.device.targetTemp / 10;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  async handleTargetTemperatureSet(value: CharacteristicValue) {
    const roomId = this.accessory.context.device.roomId;
    try {
      const duration = this.platform.config.duration || 60; // default 60 minutes
      await this.platform.mystrataheatApi.setTargetTemperature(roomId, value as number, duration as number);
    } catch (error) {
      this.platform.log.error('Failed to set target temperature', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.platform.log.debug('Set TemperatureDisplayUnits:', value);
  }
}
