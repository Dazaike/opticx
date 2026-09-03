import http from 'http';
import { CameraInfo, BatteryInfo } from '../shared/types';

export class DroidCamHttpClient {
  private host: string;
  private port: number;

  constructor(host: string = '192.168.1.184', port: number = 4747) {
    this.host = host;
    this.port = port;
  }

  setEndpoint(host: string, port: number = 4747) {
    this.host = host;
    this.port = port;
  }

  private request(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const headers: Record<string, string> = {
      'User-Agent': 'DroidCamDesktop/1.0',
      'Accept': 'application/json, text/plain, */*'
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const options: http.RequestOptions = {
      hostname: this.host,
      port: this.port,
      path: path,
      method: method,
      timeout: 4000,
      headers
    };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP request to ${path} timed out`));
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
      return promise;
  }

  async getPhoneName(): Promise<string> {
    try {
      const res = await this.request('GET', '/v1/phone/name');
      const parsed = JSON.parse(res);
      return parsed.name || parsed.phone || res;
    } catch {
      return 'Android Device';
    }
  }

  async getBatteryInfo(): Promise<BatteryInfo> {
    const res = await this.request('GET', '/v1/phone/battery_info');
    const parsed = JSON.parse(res);
    return {
      level: parsed.level ?? 0,
      state: parsed.state ?? 0,
      charging: parsed.state === 702 || parsed.state === 701 || (parsed.state > 700 && parsed.state < 800)
    };
  }

  async getCameraList(): Promise<Array<{ id: number; name: string }>> {
    try {
      const res = await this.request('GET', '/v1/camera/camera_list');
      const parsed = JSON.parse(res);
      // Example: {"cameras": [{"id": 0, "name": "Back"}, {"id": 1, "name": "Front"}]}
      if (Array.isArray(parsed.cameras)) {
        return parsed.cameras;
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [
        { id: 0, name: 'Back Camera' },
        { id: 1, name: 'Front Camera' }
      ];
    } catch {
      return [
        { id: 0, name: 'Back Camera' },
        { id: 1, name: 'Front Camera' }
      ];
    }
  }

  async getCameraInfo(): Promise<any> {
    try {
      const res = await this.request('GET', '/v1/camera/info');
      return JSON.parse(res);
    } catch (e) {
      console.warn('Failed to parse camera info:', e);
      return {};
    }
  }

  async toggleTorch(): Promise<boolean> {
    const res = await this.request('PUT', '/v1/camera/torch_toggle');
    try {
      const parsed = JSON.parse(res);
      return Boolean(parsed.torch || parsed.status === 'ok');
    } catch {
      return true;
    }
  }

  async triggerAutofocus(): Promise<boolean> {
    await this.request('PUT', '/v1/camera/autofocus');
    return true;
  }

  async setAutofocusMode(mode: number): Promise<boolean> {
    await this.request('PUT', `/v1/camera/autofocus_mode/${mode}`);
    return true;
  }

  async setZoom(val: number): Promise<boolean> {
    await this.request('PUT', `/v3/camera/zoom/${val}`);
    return true;
  }

  async setExposureValue(ev: number): Promise<boolean> {
    await this.request('PUT', `/v3/camera/ev/${ev}`);
    return true;
  }

  async setIso(iso: number): Promise<boolean> {
    await this.request('PUT', `/v3/camera/iso/${iso}`);
    return true;
  }

  async setShutterSpeed(ss: number): Promise<boolean> {
    await this.request('PUT', `/v3/camera/ss/${ss}`);
    return true;
  }

  async setManualFocus(val: number): Promise<boolean> {
    await this.request('PUT', `/v3/camera/mf/${val}`);
    return true;
  }

  async setWhiteBalanceMode(mode: number): Promise<boolean> {
    await this.request('PUT', `/v1/camera/wb_mode/${mode}`);
    return true;
  }

  async setActiveCamera(camId: number): Promise<boolean> {
    await this.request('PUT', `/v1/camera/active/${camId}`);
    return true;
  }
}
