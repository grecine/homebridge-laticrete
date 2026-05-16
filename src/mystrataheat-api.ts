import axios from 'axios';
import { Logger } from 'homebridge';

// Using the same endpoint structure as Warmup
const BASE_URL = 'https://api.warmup.com/apps/app/v1';
const APP_TOKEN = 'M=;He<Xtg"$}4N%5k{$:PD+WA"]D<;#PriteY|VTuA>_iyhs+vA"4lic{6-LqNM:';

const HEADERS = {
  'user-agent': 'WARMUP_APP',
  'accept-encoding': 'br, gzip, deflate',
  'accept': '*/*',
  'Connection': 'keep-alive',
  'content-type': 'application/json',
  'app-token': APP_TOKEN,
  'app-version': '1.8.1',
  'accept-language': 'en-us'
};

export class MyStrataHeatAPI {
  private token: string | null = null;
  private locId: number | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logger
  ) {}

  private async request(body: any) {
    try {
      const response = await axios.post(BASE_URL, body, { headers: HEADERS });
      if (response.data && response.data.status && response.data.status.result === 'success') {
        return response.data;
      } else {
        throw new Error(JSON.stringify(response.data));
      }
    } catch (error: any) {
      this.log.error('API Request failed', error.message || error);
      throw error;
    }
  }

  async login() {
    this.log.debug('Logging into MyStrataHeat/Warmup API...');
    const body = {
      request: {
        email: this.email,
        password: this.password,
        method: 'userLogin',
        appId: 'WARMUP-APP-V001'
      }
    };

    const res = await this.request(body);
    this.token = res.response.token;
    this.log.debug('Login successful, token retrieved.');
  }

  async getLocations() {
    if (!this.token) throw new Error('Not logged in');
    
    const body = {
      account: {
        email: this.email,
        token: this.token
      },
      request: {
        method: 'getLocations'
      }
    };

    const res = await this.request(body);
    const locations = res.response.locations || [];
    if (locations.length > 0) {
      this.locId = locations[0].id;
    }
    return locations;
  }

  async getRooms(locId: number) {
    if (!this.token) throw new Error('Not logged in');
    
    const body = {
      account: {
        email: this.email,
        token: this.token
      },
      request: {
        method: 'getRooms',
        locId: locId
      }
    };

    const res = await this.request(body);
    return res.response.rooms || [];
  }
  
  async getRoomStatus(roomId: number) {
    if (!this.locId) return null;
    const rooms = await this.getRooms(this.locId);
    return rooms.find((r: any) => r.roomId === roomId);
  }

  async setTargetTemperature(roomId: number, tempCelsius: number, durationMinutes: number = 60) {
    if (!this.token) throw new Error('Not logged in');

    const untilDate = new Date(Date.now() + durationMinutes * 60000);
    const until = untilDate.toISOString().slice(11, 16); // format HH:MM

    const body = {
      account: {
        email: this.email,
        token: this.token
      },
      request: {
        method: 'setOverride',
        rooms: [roomId],
        type: 3,
        temp: Math.round(tempCelsius * 10), // temperature is expected in 10x
        until: until
      }
    };

    await this.request(body);
  }

  private async setRoomMode(roomId: number, mode: 'prog' | 'override' | 'fixed' | 'off', tempCelsius?: number) {
    if (!this.token) throw new Error('Not logged in');

    const body: any = {
      account: {
        email: this.email,
        token: this.token
      },
      request: {
        method: 'setProgramme',
        roomId: roomId,
        roomMode: mode
      }
    };

    if (tempCelsius !== undefined && mode === 'fixed') {
      body.request.fixed = {
        fixedTemp: Math.round(tempCelsius * 10).toString().padStart(3, '0')
      };
    }

    await this.request(body);
  }

  async setRoomAuto(roomId: number) {
    await this.setRoomMode(roomId, 'prog');
  }

  async setRoomOverride(roomId: number) {
    await this.setRoomMode(roomId, 'override');
  }

  async setRoomFixed(roomId: number, tempCelsius?: number) {
    await this.setRoomMode(roomId, 'fixed', tempCelsius);
  }

  async setRoomOff(roomId: number) {
    if (!this.token || !this.locId) throw new Error('Not logged in or locId missing');

    const body = {
      account: {
        email: this.email,
        token: this.token
      },
      request: {
        method: 'setModes',
        values: {
          holEnd: '-',
          fixedTemp: '',
          holStart: '-',
          geoMode: '0',
          holTemp: '-',
          locId: this.locId,
          locMode: 'off'
        }
      }
    };

    await this.request(body);
  }
}
