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

/* ── Alert Sound ─────────────────────────────────── */

function playAlertBeep(severity: "warning" | "critical"): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = severity === "critical" ? 880 : 660;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
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
