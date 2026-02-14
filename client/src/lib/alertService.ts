/**
 * alertService.ts — SigINT Alert System
 *
 * Manages configurable SNR thresholds and alert state.
 * Persists settings in localStorage. Fires alerts when:
 * - SNR drops below a user-set threshold
 * - A station goes offline
 * - ADC overload is detected
 * - SNR drops rapidly (delta alert)
 */

/* ── Types ────────────────────────────────────────── */

export type AlertSoundType =
  | "classic_beep"
  | "radar_ping"
  | "sonar_pulse"
  | "klaxon"
  | "morse_sos"
  | "geiger"
  | "tritone"
  | "emergency_siren";

export interface AlertSoundOption {
  id: AlertSoundType;
  label: string;
  description: string;
}

export const ALERT_SOUNDS: AlertSoundOption[] = [
  { id: "classic_beep", label: "Classic Beep", description: "Simple sine wave tone" },
  { id: "radar_ping", label: "Radar Ping", description: "Short radar-style sweep" },
  { id: "sonar_pulse", label: "Sonar Pulse", description: "Submarine sonar ping" },
  { id: "klaxon", label: "Klaxon", description: "Alternating two-tone alarm" },
  { id: "morse_sos", label: "Morse SOS", description: "... --- ... in Morse code" },
  { id: "geiger", label: "Geiger Counter", description: "Rapid clicking bursts" },
  { id: "tritone", label: "Tri-Tone", description: "Three ascending notes" },
  { id: "emergency_siren", label: "Emergency Siren", description: "Rising/falling siren sweep" },
];

export interface AlertConfig {
  /** Enable/disable the alert system globally */
  enabled: boolean;
  /** SNR threshold in dB — alert when SNR drops below this */
  snrThreshold: number;
  /** Alert when station goes offline */
  alertOnOffline: boolean;
  /** Alert on ADC overload */
  alertOnAdcOverload: boolean;
  /** Alert on rapid SNR drop (>= deltaDrop dB in one poll cycle) */
  alertOnRapidDrop: boolean;
  /** Minimum dB drop between polls to trigger rapid drop alert */
  deltaDropThreshold: number;
  /** Cooldown in seconds between repeated alerts for the same station */
  cooldownSeconds: number;
  /** Play audio beep on alert */
  soundEnabled: boolean;
  /** Selected alert sound */
  soundType: AlertSoundType;
  /** Sound volume (0-1) */
  soundVolume: number;
}

export interface AlertEvent {
  id: string;
  ts: string;
  stationLabel: string;
  receiverUrl: string;
  type: "snr_low" | "offline" | "adc_overload" | "rapid_drop";
  message: string;
  severity: "warning" | "critical";
  snrValue?: number;
  previousSnr?: number;
  acknowledged: boolean;
}

interface AlertState {
  /** Last known SNR per station key */
  lastSnr: Record<string, number>;
  /** Last known online status per station key */
  lastOnline: Record<string, boolean>;
  /** Timestamp of last alert per station+type key */
  lastAlertTime: Record<string, number>;
  /** Recent alert events (kept in memory, last 50) */
  events: AlertEvent[];
}

/* ── Constants ───────────────────────────────────── */

const CONFIG_KEY = "sigint-alert-config";
const HISTORY_KEY = "sigint-alert-history";
const MAX_EVENTS = 50;

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  snrThreshold: 8,
  alertOnOffline: true,
  alertOnAdcOverload: true,
  alertOnRapidDrop: true,
  deltaDropThreshold: 5,
  cooldownSeconds: 120,
  soundEnabled: false,
  soundType: "classic_beep",
  soundVolume: 0.3,
};

/* ── State ───────────────────────────────────────── */

let state: AlertState = {
  lastSnr: {},
  lastOnline: {},
  lastAlertTime: {},
  events: [],
};

/* ── Config Management ───────────────────────────── */

export function getAlertConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function setAlertConfig(config: Partial<AlertConfig>): AlertConfig {
  const current = getAlertConfig();
  const updated = { ...current, ...config };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

export function resetAlertConfig(): AlertConfig {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(DEFAULT_CONFIG));
  return { ...DEFAULT_CONFIG };
}

/* ── Alert History ───────────────────────────────── */

function loadHistory(): AlertEvent[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveHistory(events: AlertEvent[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export function getAlertHistory(): AlertEvent[] {
  return loadHistory();
}

export function clearAlertHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
  state.events = [];
}

export function acknowledgeAlert(id: string): void {
  const history = loadHistory();
  const idx = history.findIndex((e) => e.id === id);
  if (idx >= 0) {
    history[idx].acknowledged = true;
    saveHistory(history);
  }
}

export function getUnacknowledgedCount(): number {
  return loadHistory().filter((e) => !e.acknowledged).length;
}

/* ── Core: Check & Fire Alerts ───────────────────── */

export interface PollData {
  online: boolean;
  snr: number;
  adcOverload: boolean;
}

/**
 * Check incoming poll data against thresholds and return any new alerts.
 * Call this after each successful fetch in SignalStrength.
 */
export function checkAlerts(
  stationLabel: string,
  receiverUrl: string,
  data: PollData
): AlertEvent[] {
  const config = getAlertConfig();
  if (!config.enabled) return [];

  const stationKey = `${stationLabel}|||${receiverUrl}`;
  const now = Date.now();
  const newAlerts: AlertEvent[] = [];

  // Helper to check cooldown
  const canAlert = (type: string): boolean => {
    const key = `${stationKey}|||${type}`;
    const last = state.lastAlertTime[key] || 0;
    return now - last >= config.cooldownSeconds * 1000;
  };

  const recordAlert = (type: string): void => {
    const key = `${stationKey}|||${type}`;
    state.lastAlertTime[key] = now;
  };

  // 1. Offline detection
  if (config.alertOnOffline && !data.online) {
    const wasOnline = state.lastOnline[stationKey];
    if (wasOnline !== false && canAlert("offline")) {
      newAlerts.push({
        id: `alert-${now}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        stationLabel,
        receiverUrl,
        type: "offline",
        message: `${stationLabel} has gone OFFLINE`,
        severity: "critical",
        acknowledged: false,
      });
      recordAlert("offline");
    }
  }

  // 2. SNR below threshold
  if (data.snr > 0 && data.snr < config.snrThreshold && data.online) {
    if (canAlert("snr_low")) {
      newAlerts.push({
        id: `alert-${now}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        stationLabel,
        receiverUrl,
        type: "snr_low",
        message: `${stationLabel} SNR dropped to ${data.snr} dB (threshold: ${config.snrThreshold} dB)`,
        severity: data.snr <= 3 ? "critical" : "warning",
        snrValue: data.snr,
        acknowledged: false,
      });
      recordAlert("snr_low");
    }
  }

  // 3. Rapid SNR drop
  if (config.alertOnRapidDrop && data.snr > 0 && data.online) {
    const prevSnr = state.lastSnr[stationKey];
    if (prevSnr !== undefined && prevSnr > 0) {
      const drop = prevSnr - data.snr;
      if (drop >= config.deltaDropThreshold && canAlert("rapid_drop")) {
        newAlerts.push({
          id: `alert-${now}-${Math.random().toString(36).slice(2, 8)}`,
          ts: new Date().toISOString(),
          stationLabel,
          receiverUrl,
          type: "rapid_drop",
          message: `${stationLabel} SNR dropped ${drop} dB (${prevSnr} → ${data.snr} dB)`,
          severity: drop >= 10 ? "critical" : "warning",
          snrValue: data.snr,
          previousSnr: prevSnr,
          acknowledged: false,
        });
        recordAlert("rapid_drop");
      }
    }
  }

  // 4. ADC overload
  if (config.alertOnAdcOverload && data.adcOverload && data.online) {
    if (canAlert("adc_overload")) {
      newAlerts.push({
        id: `alert-${now}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        stationLabel,
        receiverUrl,
        type: "adc_overload",
        message: `${stationLabel} ADC overload detected`,
        severity: "warning",
        acknowledged: false,
      });
      recordAlert("adc_overload");
    }
  }

  // Update state
  if (data.snr > 0) state.lastSnr[stationKey] = data.snr;
  state.lastOnline[stationKey] = data.online;

  // Persist new alerts
  if (newAlerts.length > 0) {
    const history = loadHistory();
    history.push(...newAlerts);
    saveHistory(history);
    state.events = history;

    // Play alert sound if enabled
    if (config.soundEnabled) {
      playAlertBeep(newAlerts[0].severity);
    }
  }

  return newAlerts;
}

/* ── Alert Sound System ──────────────────────────── */

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function playAlertBeep(severity: "warning" | "critical"): void {
  const config = getAlertConfig();
  playAlertSound(config.soundType, severity, config.soundVolume);
}

/** Play a specific alert sound — used by both alerts and preview */
export function playAlertSound(
  soundType: AlertSoundType,
  severity: "warning" | "critical" = "warning",
  volume: number = 0.3
): void {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();
    const masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(ctx.destination);
    const t = ctx.currentTime;

    switch (soundType) {
      case "classic_beep": {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(masterGain);
        osc.frequency.value = severity === "critical" ? 880 : 660;
        osc.type = "sine";
        g.gain.setValueAtTime(1, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.35);
        break;
      }

      case "radar_ping": {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(masterGain);
        const baseFreq = severity === "critical" ? 2400 : 1800;
        osc.frequency.setValueAtTime(baseFreq, t);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.3, t + 0.15);
        osc.type = "sine";
        g.gain.setValueAtTime(0.8, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t);
        osc.stop(t + 0.25);
        break;
      }

      case "sonar_pulse": {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(masterGain);
        osc.frequency.value = severity === "critical" ? 1200 : 800;
        osc.type = "sine";
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.9, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t);
        osc.stop(t + 0.65);
        break;
      }

      case "klaxon": {
        for (let i = 0; i < 3; i++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.connect(g);
          g.connect(masterGain);
          const freq = i % 2 === 0
            ? (severity === "critical" ? 800 : 600)
            : (severity === "critical" ? 600 : 450);
          osc.frequency.value = freq;
          osc.type = "square";
          const start = t + i * 0.15;
          g.gain.setValueAtTime(0.4, start);
          g.gain.setValueAtTime(0.001, start + 0.12);
          osc.start(start);
          osc.stop(start + 0.13);
        }
        break;
      }

      case "morse_sos": {
        // ... --- ... (dit dit dit dah dah dah dit dit dit)
        const ditLen = 0.06;
        const dahLen = 0.18;
        const gap = 0.04;
        const pattern = [ditLen, ditLen, ditLen, dahLen, dahLen, dahLen, ditLen, ditLen, ditLen];
        let offset = 0;
        const freq = severity === "critical" ? 1000 : 750;
        pattern.forEach((dur) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.connect(g);
          g.connect(masterGain);
          osc.frequency.value = freq;
          osc.type = "sine";
          g.gain.setValueAtTime(0.7, t + offset);
          g.gain.setValueAtTime(0.001, t + offset + dur);
          osc.start(t + offset);
          osc.stop(t + offset + dur + 0.01);
          offset += dur + gap;
        });
        break;
      }

      case "geiger": {
        const clicks = severity === "critical" ? 12 : 7;
        for (let i = 0; i < clicks; i++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.connect(g);
          g.connect(masterGain);
          osc.frequency.value = 4000 + Math.random() * 2000;
          osc.type = "square";
          const start = t + i * (0.03 + Math.random() * 0.04);
          g.gain.setValueAtTime(0.5, start);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.015);
          osc.start(start);
          osc.stop(start + 0.02);
        }
        break;
      }

      case "tritone": {
        const notes = severity === "critical"
          ? [523.25, 659.25, 783.99]  // C5 E5 G5
          : [392, 493.88, 587.33];     // G4 B4 D5
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.connect(g);
          g.connect(masterGain);
          osc.frequency.value = freq;
          osc.type = "triangle";
          const start = t + i * 0.12;
          g.gain.setValueAtTime(0.6, start);
          g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
          osc.start(start);
          osc.stop(start + 0.25);
        });
        break;
      }

      case "emergency_siren": {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(masterGain);
        osc.type = "sawtooth";
        const lo = severity === "critical" ? 600 : 400;
        const hi = severity === "critical" ? 1400 : 1000;
        osc.frequency.setValueAtTime(lo, t);
        osc.frequency.linearRampToValueAtTime(hi, t + 0.3);
        osc.frequency.linearRampToValueAtTime(lo, t + 0.6);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t);
        osc.stop(t + 0.7);
        break;
      }
    }
  } catch {
    // Audio not available
  }
}

/* ── Alert Type Labels ───────────────────────────── */

export const ALERT_TYPE_LABELS: Record<AlertEvent["type"], string> = {
  snr_low: "Low SNR",
  offline: "Offline",
  adc_overload: "ADC Overload",
  rapid_drop: "Rapid Drop",
};

export const ALERT_TYPE_COLORS: Record<AlertEvent["type"], string> = {
  snr_low: "#f97316",
  offline: "#ef4444",
  adc_overload: "#eab308",
  rapid_drop: "#a855f7",
};
