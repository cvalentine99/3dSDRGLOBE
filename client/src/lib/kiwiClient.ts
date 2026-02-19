/**
 * kiwiClient.ts — KiwiSDR WebSocket protocol client
 *
 * Connects to a KiwiSDR receiver's waterfall (W/F) channel through the
 * server-side WebSocket relay and emits waterfall FFT rows for rendering.
 *
 * KiwiSDR protocol:
 *   - Text commands: SET auth, SET zoom, SET maxdb/mindb, SET wf_speed, etc.
 *   - Binary responses: waterfall FFT rows (uint8 dB values per frequency bin)
 *   - Text responses: MSG key=value status updates
 *
 * The relay at /api/sdr-relay?target=ws://host:port/kiwi/N/W%2FF pipes bytes
 * transparently — this client handles the KiwiSDR-specific framing.
 */

export interface WaterfallRow {
  bins: Uint8Array; // FFT magnitude values (0-255, maps to mindb..maxdb)
  seq: number;
}

export interface KiwiStatus {
  center_freq?: number;
  bandwidth?: number;
  sample_rate?: number;
  wf_fft_size?: number;
  zoom?: number;
  start?: number;
  audio_init?: boolean;
}

export type KiwiEventMap = {
  waterfall: (row: WaterfallRow) => void;
  status: (status: KiwiStatus) => void;
  open: () => void;
  close: () => void;
  error: (err: string) => void;
};

/**
 * Build the WebSocket relay URL for a KiwiSDR receiver.
 * Converts the receiver's HTTP URL to a ws:// target for the W/F channel.
 */
export function buildKiwiWsTarget(receiverHttpUrl: string, channel: "W/F" | "SND" = "W/F"): string {
  const url = new URL(receiverHttpUrl);
  const ts = Date.now();
  const encodedChannel = channel === "W/F" ? "W%2FF" : channel;
  return `ws://${url.host}/kiwi/${ts}/${encodedChannel}`;
}

/**
 * Build the full relay URL that the browser connects to.
 */
export function buildRelayUrl(receiverHttpUrl: string, channel: "W/F" | "SND" = "W/F"): string {
  const target = buildKiwiWsTarget(receiverHttpUrl, channel);
  const relayBase = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${relayBase}//${window.location.host}/api/sdr-relay?target=${encodeURIComponent(target)}`;
}

export class KiwiClient {
  private ws: WebSocket | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Record<string, ((...args: any[]) => void)[]> = {};
  private status: KiwiStatus = {};
  private receiverUrl: string;
  private _connected = false;

  constructor(receiverUrl: string) {
    this.receiverUrl = receiverUrl;
  }

  get connected() { return this._connected; }

  on<K extends keyof KiwiEventMap>(event: K, fn: KiwiEventMap[K]) {
    (this.listeners[event] ??= []).push(fn as (...args: any[]) => void);
    return this;
  }

  off<K extends keyof KiwiEventMap>(event: K, fn: KiwiEventMap[K]) {
    const arr = this.listeners[event];
    if (arr) {
      const idx = arr.indexOf(fn as (...args: any[]) => void);
      if (idx >= 0) arr.splice(idx, 1);
    }
    return this;
  }

  private emit<K extends keyof KiwiEventMap>(event: K, ...args: Parameters<KiwiEventMap[K]>) {
    const arr = this.listeners[event];
    if (arr) {
      for (const fn of arr) fn(...args);
    }
  }

  /**
   * Connect to the KiwiSDR waterfall channel through the relay.
   */
  connect(params?: { zoom?: number; mindb?: number; maxdb?: number; wf_speed?: number }) {
    const zoom = params?.zoom ?? 0;
    const mindb = params?.mindb ?? -110;
    const maxdb = params?.maxdb ?? -10;
    const wfSpeed = params?.wf_speed ?? 4;

    const relayUrl = buildRelayUrl(this.receiverUrl, "W/F");
    this.ws = new WebSocket(relayUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this._connected = true;
      // KiwiSDR handshake sequence
      this.send("SET auth t=kiwi p=#");
      // Request waterfall setup
      this.send(`SET zoom=${zoom} start=0`);
      this.send(`SET maxdb=${maxdb} mindb=${mindb}`);
      this.send(`SET wf_speed=${wfSpeed}`);
      this.send("SET wf_comp=0"); // no compression for simplicity
      this.send("SET ident_user=SDRGlobe");
      this.emit("open");
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handleBinary(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        this.handleText(event.data);
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.emit("close");
    };

    this.ws.onerror = () => {
      this.emit("error", "WebSocket connection failed");
    };
  }

  /**
   * Tune to a frequency (only works if also connected on SND channel — for W/F
   * this adjusts the waterfall center via zoom/start commands).
   */
  setZoom(zoom: number, start: number) {
    this.send(`SET zoom=${zoom} start=${start}`);
  }

  setDbRange(mindb: number, maxdb: number) {
    this.send(`SET maxdb=${maxdb} mindb=${mindb}`);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  private send(msg: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    }
  }

  /**
   * Parse binary waterfall frame from KiwiSDR.
   *
   * Frame format (observed from KiwiSDR source):
   *   Byte 0:     flags (bit 7 = WF_FLAGS_NEW_MAP)
   *   Bytes 1-2:  x_bin_server (uint16 big-endian)
   *   Bytes 3-6:  sequence number (uint32 big-endian)
   *   Byte 7:     unused
   *   Bytes 8+:   FFT magnitude data (uint8[], one per frequency bin)
   *
   * Some KiwiSDR versions send a leading "W/F" text tag in binary frames.
   * We detect and skip it.
   */
  private handleBinary(data: Uint8Array) {
    if (data.length < 10) return;

    let offset = 0;

    // Check for "W/F" prefix (0x57 0x2F 0x46) — some versions include it
    if (data[0] === 0x57 && data[1] === 0x2F && data[2] === 0x46) {
      offset = 3;
    }
    // Check for "MSG" prefix — text message encoded as binary
    if (data[0] === 0x4D && data[1] === 0x53 && data[2] === 0x47) {
      const text = new TextDecoder().decode(data.subarray(3));
      this.handleText("MSG" + text);
      return;
    }

    if (data.length < offset + 8) return;

    // Parse header
    const _flags = data[offset];
    // const xBin = (data[offset + 1] << 8) | data[offset + 2];
    const seq = (data[offset + 3] << 24) | (data[offset + 4] << 16) |
                (data[offset + 5] << 8) | data[offset + 6];

    // FFT data starts after the 8-byte header
    const fftData = data.subarray(offset + 8);

    if (fftData.length > 0) {
      this.emit("waterfall", { bins: fftData, seq });
    }
  }

  /**
   * Parse text status messages.
   * Format: "MSG key1=value1 key2=value2 ..."
   */
  private handleText(text: string) {
    if (!text.startsWith("MSG")) return;
    const body = text.substring(4);
    const parts = body.split(" ");

    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const key = part.substring(0, eq);
      const val = part.substring(eq + 1);

      switch (key) {
        case "center_freq":
          this.status.center_freq = parseFloat(val);
          break;
        case "bandwidth":
          this.status.bandwidth = parseFloat(val);
          break;
        case "sample_rate":
          this.status.sample_rate = parseFloat(val);
          break;
        case "wf_fft_size":
          this.status.wf_fft_size = parseInt(val, 10);
          break;
        case "zoom":
          this.status.zoom = parseInt(val, 10);
          break;
        case "start":
          this.status.start = parseInt(val, 10);
          break;
        case "audio_init":
          this.status.audio_init = true;
          this.emit("status", { ...this.status });
          break;
      }
    }
  }
}
