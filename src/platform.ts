import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MyStrataHeatAccessory } from './platformAccessory';
import { MyStrataHeatAPI, NormalizedRoom } from './mystrataheat-api';
import { addEveCharacteristics } from './eveCharacteristics';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fakegatoHistory = require('fakegato-history');

export class MyStrataHeatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Accessories restored from Homebridge's on-disk cache at startup.
  public readonly accessories: PlatformAccessory[] = [];

  // Map from UUID → handler instance. Keyed separately from context so we
  // never store class instances on accessory.context (which gets JSON-serialized
  // to disk and would either lose the reference or corrupt the cache file).
  public readonly accessoryHandlers = new Map<string, MyStrataHeatAccessory>();

  public readonly mystrataheatApi!: MyStrataHeatAPI;
  public readonly eveCharacteristics: any;
  public readonly FakeGatoHistoryService: any;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.eveCharacteristics = addEveCharacteristics(this.api);
    this.FakeGatoHistoryService = fakegatoHistory(this.api);
    this.log.debug('Finished initializing platform:', this.config.name);

    const email = config.email as string;
    const password = config.password as string;

    if (!email || !password) {
      this.log.error('Missing email or password in configuration. Please update config.json');
      return;
    }

    this.mystrataheatApi = new MyStrataHeatAPI(email, password, this.log);

    // Wait for Homebridge to finish loading all cached accessories from disk
    // before hitting the API, so we can correctly identify deltas.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  /**
   * Called by Homebridge for each accessory loaded from the on-disk cache.
   * We stash it so discoverDevices can match it against live API data.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Logs in, fetches all rooms from the GraphQL API, reconciles them with
   * the cached accessories, then starts the central poll loop.
   */
  async discoverDevices() {
    try {
      await this.mystrataheatApi.login();
      const rooms = await this.mystrataheatApi.getStatus();

      if (rooms.length === 0) {
        this.log.warn('No rooms found for this account. Keeping cached accessories visible.');
        return;
      }

      for (const room of rooms) {
        const uuid = this.api.hap.uuid.generate(`mystrataheat-${room.roomId}`);
        const existingAccessory = this.accessories.find((a) => a.UUID === uuid);

        let targetAccessory: PlatformAccessory;

        if (existingAccessory) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
          existingAccessory.context.device = room;
          this.api.updatePlatformAccessories([existingAccessory]);
          targetAccessory = existingAccessory;
        } else {
          this.log.info('Adding new accessory:', room.roomName);
          const newAccessory = new this.api.platformAccessory(room.roomName, uuid);
          newAccessory.context.device = room;
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [newAccessory]);
          this.accessories.push(newAccessory);
          targetAccessory = newAccessory;
        }

        // CRITICAL: register handler for BOTH cached and new accessories.
        // Cached accessories are the primary path on every restart after the first.
        const handler = new MyStrataHeatAccessory(this, targetAccessory);
        this.accessoryHandlers.set(uuid, handler);

        // Push live state immediately — no 60-second wait on startup.
        handler.updateStatusWithRoom(room);
      }

      // Start the central poll loop after all handlers are registered.
      this.startPolling();
    } catch (error) {
      this.log.error('Error discovering devices:', error);
    }
  }

  /**
   * Starts a single shared poll loop that fetches all rooms once per interval
   * and distributes updates to each accessory handler. This replaces the old
   * per-accessory setInterval pattern, which fetched all rooms N times per cycle.
   */
  private startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);

    const intervalMs = (this.config.refresh || 60) * 1000;
    this.log.debug(`Starting central poll loop every ${this.config.refresh || 60}s`);

    this.pollTimer = setInterval(async () => {
      try {
        const rooms: NormalizedRoom[] = await this.mystrataheatApi.getStatus();
        for (const room of rooms) {
          const uuid = this.api.hap.uuid.generate(`mystrataheat-${room.roomId}`);
          const handler = this.accessoryHandlers.get(uuid);
          if (handler) {
            handler.updateStatusWithRoom(room);
          }
        }
      } catch (err: any) {
        this.log.error('Poll failed:', err.message || err);
      }
    }, intervalMs);
  }
}
