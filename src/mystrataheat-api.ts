import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';

// REST endpoint — used only for login.
const REST_URL = 'https://api.warmup.com/apps/app/v1';
// GraphQL endpoint — used for all data reads and mutations.
const GRAPHQL_URL = 'https://apil.warmup.com/graphql';

const APP_TOKEN = 'M=;He<Xtg"$}4N%5k{$:PD+WA"]D<;#PriteY|VTuA>_iyhs+vA"4lic{6-LqNM:';
const REQUEST_TIMEOUT_MS = 10000;

const BASE_HEADERS = {
  'user-agent': 'WARMUP_APP',
  'accept-encoding': 'br, gzip, deflate',
  accept: '*/*',
  Connection: 'keep-alive',
  'content-type': 'application/json',
  'app-token': APP_TOKEN,
  'app-version': '1.8.1',
  'accept-language': 'en-us',
};

// ---------------------------------------------------------------------------
// Types — derived from live schema validation against a real Laticrete account
// ---------------------------------------------------------------------------

// Raw GraphQL room shape as returned by the API.
// Note: airTemp/floor1Temp/floor2Temp are STRINGS (e.g. "270"), not numbers.
interface GraphQLThermostat {
  deviceSN?: string;
  appFw?: string;
  wifiFw?: string;
  airTemp?: string;
  floor1Temp?: string;
  floor2Temp?: string;
  minTemp?: number;
  maxTemp?: number;
  lastPoll?: number;
  isFaultAir?: boolean;
  isFaultFloor1?: boolean;
  isFaultFloor2?: boolean;
  parameters?: {
    outputStatus?: number;
    lock?: number;
  };
}

interface GraphQLRoom {
  id: number;
  roomName: string;
  runMode: string;
  roomMode: string;
  targetTemp: number;
  currentTemp: number;
  overrideDur?: number;
  overrideTemp?: number;
  fixedTemp?: number;
  energy?: string;
  cost?: string;
  total?: number;
  thermostat4ies?: GraphQLThermostat[];
}

// Flattened room shape used by the rest of the plugin.
export interface NormalizedRoom {
  roomId: number;
  roomName: string;
  runMode: string;
  roomMode: string;
  targetTemp: number;
  currentTemp: number;
  overrideDur: number;
  overrideTemp: number;
  fixedTemp: number;
  energy: string;
  total: number;
  // Thermostat4ies fields — flattened and parsed to numbers
  airTemp: number;
  floor1Temp: number;
  floor2Temp: number;
  minTemp: number;
  maxTemp: number;
  lastPoll: number;
  isFaultAir: boolean;
  isFaultFloor1: boolean;
  isFaultFloor2: boolean;
  outputStatus: number | null;
  lock: boolean | null;
  deviceSN: string;
  appFw: string;
}

// ---------------------------------------------------------------------------
// GraphQL query and mutations
// ---------------------------------------------------------------------------

const GQL_OWNED_AND_ROOMS = `
  query OwnedAndRooms {
    user {
      owned {
        id
        name
        rooms {
          id
          roomName
          runMode
          roomMode
          targetTemp
          currentTemp
          overrideDur
          overrideTemp
          fixedTemp
          energy
          cost
          total
          thermostat4ies {
            deviceSN
            appFw
            wifiFw
            airTemp
            floor1Temp
            floor2Temp
            minTemp
            maxTemp
            lastPoll
            isFaultAir
            isFaultFloor1
            isFaultFloor2
            parameters { outputStatus lock }
          }
        }
      }
    }
  }
`.trim();

const GQL_DEVICE_PROGRAM = 'mutation DeviceProgram($lid: Int!, $rid: Int) { deviceProgram(lid: $lid, rid: $rid) }';
const GQL_DEVICE_OFF = 'mutation DeviceOff($lid: Int!, $rid: Int) { deviceOff(lid: $lid, rid: $rid) }';
const GQL_DEVICE_OVERRIDE =
  'mutation DeviceOverride($lid: Int!, $rid: Int, $temperature: Int!, $minutes: Int!) ' +
  '{ deviceOverride(lid: $lid, rid: $rid, temperature: $temperature, minutes: $minutes) }';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flattens a raw GraphQL room into the NormalizedRoom shape used by
 * the rest of the plugin. Performs all type coercions here so callers
 * never need to worry about string temperatures.
 */
function normalizeRoom(r: GraphQLRoom): NormalizedRoom {
  const t: GraphQLThermostat = (r.thermostat4ies && r.thermostat4ies[0]) || {};
  const params = t.parameters || {};
  return {
    roomId: r.id,
    roomName: r.roomName,
    runMode: r.runMode,
    roomMode: r.roomMode,
    targetTemp: r.targetTemp ?? 0,
    currentTemp: r.currentTemp ?? 0,
    overrideDur: r.overrideDur ?? 0,
    overrideTemp: r.overrideTemp ?? 0,
    fixedTemp: r.fixedTemp ?? 0,
    energy: r.energy ?? '0',
    total: r.total ?? 0,
    // airTemp/floor1Temp/floor2Temp come back as strings — parse them
    airTemp: parseInt(t.airTemp ?? '0', 10),
    floor1Temp: parseInt(t.floor1Temp ?? '0', 10),
    floor2Temp: parseInt(t.floor2Temp ?? '0', 10),
    minTemp: t.minTemp ?? 50,
    maxTemp: t.maxTemp ?? 300,
    lastPoll: t.lastPoll ?? 0,
    isFaultAir: t.isFaultAir ?? false,
    isFaultFloor1: t.isFaultFloor1 ?? false,
    isFaultFloor2: t.isFaultFloor2 ?? false,
    outputStatus: typeof params.outputStatus === 'number' ? params.outputStatus : null,
    lock: typeof params.lock === 'number' ? params.lock !== 0 : null,
    deviceSN: t.deviceSN ?? '',
    appFw: t.appFw ?? '',
  };
}

// ---------------------------------------------------------------------------
// API class
// ---------------------------------------------------------------------------

export class MyStrataHeatAPI {
  private token: string | null = null;
  private locId: number | null = null;
  // Mutex: when non-null, a re-auth is in flight. Other callers wait on it.
  private reAuthPromise: Promise<void> | null = null;

  private readonly http: AxiosInstance;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    this.http = axios.create({ timeout: REQUEST_TIMEOUT_MS });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async login(): Promise<void> {
    this.log.debug('Logging into MyStrataHeat/Warmup API...');
    const body = {
      request: {
        email: this.email,
        password: this.password,
        method: 'userLogin',
        appId: 'WARMUP-APP-V001',
      },
    };

    try {
      const res = await this.http.post(REST_URL, body, { headers: BASE_HEADERS });
      if (res.data?.status?.result !== 'success') {
        throw new Error(res.data?.status?.message ?? 'Login failed');
      }
      this.token = res.data.response.token;
      this.log.debug('Login successful, token retrieved.');
    } catch (error: any) {
      this.log.error('Login failed:', error.message || error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // GraphQL transport
  // ---------------------------------------------------------------------------

  private async graphqlRequest(query: string, variables: Record<string, unknown> = {}): Promise<any> {
    if (!this.token) throw new Error('Not authenticated — call login() first');

    try {
      const res = await this.http.post(
        GRAPHQL_URL,
        { query, variables },
        {
          headers: {
            ...BASE_HEADERS,
            'warmup-authorization': this.token,
          },
        },
      );

      if (res.data?.errors?.length) {
        const detail = (res.data.errors as Array<{ message: string }>).map((e) => e.message).join('; ');
        throw new Error(`Warmup GraphQL: ${detail}`);
      }

      return res.data.data;
    } catch (error: any) {
      this.log.error('GraphQL request failed:', error.message || error);
      throw error;
    }
  }

  /**
   * Sends a GraphQL request. On token-related failures (HTTP 401 or a
   * GraphQL error mentioning auth), re-authenticates once and retries.
   * A mutex prevents concurrent poll cycles from each triggering their
   * own parallel re-auth storm.
   */
  private async authenticatedGraphQL(query: string, variables: Record<string, unknown> = {}): Promise<any> {
    try {
      return await this.graphqlRequest(query, variables);
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      const isAuthError = msg.includes('401') || /\b(token|auth|unauthorized|forbidden)\b/i.test(msg);

      if (!isAuthError) throw err;

      // Ensure only one re-auth flies at a time
      if (!this.reAuthPromise) {
        this.log.warn('Token rejected by Warmup API — re-authenticating...');
        this.reAuthPromise = this.login().finally(() => {
          this.reAuthPromise = null;
        });
      }
      await this.reAuthPromise;
      return this.graphqlRequest(query, variables);
    }
  }

  // ---------------------------------------------------------------------------
  // Data reads
  // ---------------------------------------------------------------------------

  /**
   * Fetches all rooms for the first owned location. Also stores `locId`
   * internally so mutations can use it without being passed it explicitly.
   * This is the single source of truth — called by the platform poll loop.
   */
  async getStatus(): Promise<NormalizedRoom[]> {
    const data = await this.authenticatedGraphQL(GQL_OWNED_AND_ROOMS);
    // Note: supports single-location setups (owned[0]). Multi-home support
    // is a future enhancement; the vast majority of users have one location.
    const location = data?.user?.owned?.[0];
    if (!location) {
      this.log.warn('No owned locations found for this account.');
      return [];
    }
    this.locId = location.id;
    return (location.rooms as GraphQLRoom[]).map(normalizeRoom);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  private requireLocId(): number {
    if (this.locId == null) throw new Error('locId not set — call getStatus() first');
    return this.locId;
  }

  /**
   * Resumes the scheduled programme for a single room.
   */
  async setRoomAuto(roomId: number): Promise<void> {
    const lid = this.requireLocId();
    this.log.debug(`setRoomAuto: lid=${lid} rid=${roomId}`);
    await this.authenticatedGraphQL(GQL_DEVICE_PROGRAM, { lid, rid: roomId });
  }

  /**
   * Turns off heating for a single room (per-room, not location-wide).
   */
  async setRoomOff(roomId: number): Promise<void> {
    const lid = this.requireLocId();
    this.log.debug(`setRoomOff: lid=${lid} rid=${roomId}`);
    await this.authenticatedGraphQL(GQL_DEVICE_OFF, { lid, rid: roomId });
  }

  /**
   * Sets a temporary temperature override on a single room.
   * @param roomId   Room ID from the normalized room object
   * @param tempC    Target temperature in °C (will be converted to tenths)
   * @param minutes  Duration of the override in minutes
   */
  async setTargetTemperature(roomId: number, tempC: number, minutes: number = 60): Promise<void> {
    const lid = this.requireLocId();
    const temperature = Math.round(tempC * 10); // API uses tenths of a degree
    this.log.debug(`setTargetTemperature: lid=${lid} rid=${roomId} temp=${temperature} mins=${minutes}`);
    await this.authenticatedGraphQL(GQL_DEVICE_OVERRIDE, { lid, rid: roomId, temperature, minutes });
  }
}
