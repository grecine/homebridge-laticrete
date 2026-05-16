import { API, Characteristic, Formats, Perms } from 'homebridge';

export function addEveCharacteristics(api: API) {
  // Define Eve Custom Characteristics
  class CurrentConsumption extends api.hap.Characteristic {
    static readonly UUID: string = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

    constructor() {
      super('Current Consumption', CurrentConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'W',
        minValue: 0,
        maxValue: 100000,
        minStep: 0.1,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    }
  }

  class TotalConsumption extends api.hap.Characteristic {
    static readonly UUID: string = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

    constructor() {
      super('Total Consumption', TotalConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'kWh',
        minValue: 0,
        maxValue: 1000000,
        minStep: 0.01,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    }
  }

  return { CurrentConsumption, TotalConsumption };
}
