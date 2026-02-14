/**
 * AlertSettings.tsx — Alert Configuration Panel
 * Design: "Ether" dark atmospheric theme
 *
 * Allows users to configure SNR thresholds, enable/disable
 * alert types, select alert sounds, view alert history, and manage notifications.
 */

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Bell, BellOff, Settings, Trash2, Check, Volume2, VolumeX,
  AlertTriangle, WifiOff, TrendingDown, Activity, Play,
  RotateCcw
} from "lucide-react";
import {
  getAlertConfig,
  setAlertConfig,
  resetAlertConfig,
  getAlertHistory,
  clearAlertHistory,
  acknowledgeAlert,
  playAlertSound,
  ALERT_TYPE_LABELS,
  ALERT_TYPE_COLORS,
  ALERT_SOUNDS,
  type AlertConfig,
  type AlertEvent,
  type AlertSoundType,
} from "@/lib/alertService";

/* ── Types ────────────────────────────────────────── */

interface Props {
  onClose: () => void;
}

/* ── Component ────────────────────────────────────── */

export default function AlertSettings({ onClose }: Props) {
  const [config, setConfig] = useState<AlertConfig>(getAlertConfig);
  const [history, setHistory] = useState<AlertEvent[]>(getAlertHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [playingSound, setPlayingSound] = useState<string | null>(null);

  const unackCount = useMemo(
    () => history.filter((e) => !e.acknowledged).length,
    [history]
  );

  const updateConfig = (patch: Partial<AlertConfig>) => {
    const updated = setAlertConfig(patch);
    setConfig(updated);
  };

  const handleReset = () => {
    const defaults = resetAlertConfig();
    setConfig(defaults);
  };

  const handleClearHistory = () => {
    clearAlertHistory();
    setHistory([]);
  };

  const handleAcknowledge = (id: string) => {
    acknowledgeAlert(id);
    setHistory(getAlertHistory());
  };

  const handleAcknowledgeAll = () => {
    history.forEach((e) => {
      if (!e.acknowledged) acknowledgeAlert(e.id);
    });
    setHistory(getAlertHistory());
  };

  const handlePreviewSound = (soundId: AlertSoundType) => {
    setPlayingSound(soundId);
    playAlertSound(soundId, "critical", config.soundVolume);
    setTimeout(() => setPlayingSound(null), 800);
  };

  const alertTypeIcon = (type: AlertEvent["type"]) => {
    switch (type) {
      case "snr_low": return TrendingDown;
      case "offline": return WifiOff;
      case "adc_overload": return AlertTriangle;
      case "rapid_drop": return Activity;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={{ type: "spring", damping: 25, stiffness: 250 }}
      className="absolute inset-4 z-50 glass-panel rounded-2xl overflow-hidden flex flex-col"
      style={{ maxWidth: "520px", maxHeight: "700px", margin: "auto" }}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
            <Bell className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">Alert Configuration</h2>
            <p className="text-[10px] font-mono text-white/40 mt-0.5">
              {config.enabled ? "Monitoring active" : "Alerts disabled"}
              {unackCount > 0 && ` · ${unackCount} unread`}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white/70"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="px-5 pt-3 flex items-center gap-2 shrink-0">
        <button
          onClick={() => { setShowSettings(true); setShowHistory(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono transition-colors ${
            showSettings
              ? "bg-white/10 text-white/90 border border-white/15"
              : "text-white/40 hover:text-white/60 border border-transparent"
          }`}
        >
          <Settings className="w-3 h-3" />Settings
        </button>
        <button
          onClick={() => { setShowSettings(false); setShowHistory(true); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-mono transition-colors relative ${
            showHistory
              ? "bg-white/10 text-white/90 border border-white/15"
              : "text-white/40 hover:text-white/60 border border-transparent"
          }`}
        >
          <Bell className="w-3 h-3" />History
          {unackCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[8px] text-white font-bold flex items-center justify-center">
              {unackCount > 9 ? "9+" : unackCount}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {showSettings && (
          <div className="space-y-4">
            {/* Master toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/8">
              <div className="flex items-center gap-2.5">
                {config.enabled ? (
                  <Bell className="w-4 h-4 text-amber-400" />
                ) : (
                  <BellOff className="w-4 h-4 text-white/30" />
                )}
                <div>
                  <p className="text-[11px] font-medium text-white/80">Alert System</p>
                  <p className="text-[9px] text-white/35 mt-0.5">
                    {config.enabled ? "Monitoring all selected stations" : "All notifications disabled"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => updateConfig({ enabled: !config.enabled })}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  config.enabled ? "bg-amber-500/40" : "bg-white/10"
                }`}
              >
                <motion.div
                  className={`absolute top-0.5 w-4 h-4 rounded-full ${
                    config.enabled ? "bg-amber-400" : "bg-white/30"
                  }`}
                  animate={{ left: config.enabled ? 22 : 2 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            {config.enabled && (
              <>
                {/* SNR Threshold */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/8">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-3.5 h-3.5 text-orange-400/70" />
                      <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">
                        SNR Threshold
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-bold text-orange-400">
                      {config.snrThreshold} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={25}
                    step={1}
                    value={config.snrThreshold}
                    onChange={(e) => updateConfig({ snrThreshold: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-400
                      [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(251,146,60,0.4)]"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[8px] font-mono text-white/20">1 dB</span>
                    <span className="text-[8px] font-mono text-white/20">25 dB</span>
                  </div>
                  <p className="text-[9px] text-white/30 mt-1.5">
                    Alert when any monitored station's SNR drops below this value.
                  </p>
                </div>

                {/* Alert Types */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/8 space-y-2.5">
                  <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">
                    Alert Types
                  </span>

                  <ToggleRow
                    icon={WifiOff}
                    label="Station Offline"
                    description="Alert when a station goes offline"
                    enabled={config.alertOnOffline}
                    color="#ef4444"
                    onToggle={() => updateConfig({ alertOnOffline: !config.alertOnOffline })}
                  />

                  <ToggleRow
                    icon={AlertTriangle}
                    label="ADC Overload"
                    description="Alert when ADC overload is detected"
                    enabled={config.alertOnAdcOverload}
                    color="#eab308"
                    onToggle={() => updateConfig({ alertOnAdcOverload: !config.alertOnAdcOverload })}
                  />

                  <ToggleRow
                    icon={Activity}
                    label="Rapid SNR Drop"
                    description={`Alert when SNR drops ≥ ${config.deltaDropThreshold} dB in one cycle`}
                    enabled={config.alertOnRapidDrop}
                    color="#a855f7"
                    onToggle={() => updateConfig({ alertOnRapidDrop: !config.alertOnRapidDrop })}
                  />

                  {config.alertOnRapidDrop && (
                    <div className="ml-7 pl-3 border-l border-white/5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-mono text-white/40">Drop threshold</span>
                        <span className="text-[10px] font-mono font-bold text-purple-400">
                          {config.deltaDropThreshold} dB
                        </span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={15}
                        step={1}
                        value={config.deltaDropThreshold}
                        onChange={(e) => updateConfig({ deltaDropThreshold: parseInt(e.target.value) })}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                      />
                    </div>
                  )}
                </div>

                {/* Cooldown */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/8 space-y-2.5">
                  <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">
                    Behavior
                  </span>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-white/60">Cooldown period</p>
                      <p className="text-[8px] text-white/25 mt-0.5">
                        Min time between repeated alerts for the same station
                      </p>
                    </div>
                    <select
                      value={config.cooldownSeconds}
                      onChange={(e) => updateConfig({ cooldownSeconds: parseInt(e.target.value) })}
                      className="bg-white/5 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-white/70 cursor-pointer"
                    >
                      <option value={30}>30s</option>
                      <option value={60}>1 min</option>
                      <option value={120}>2 min</option>
                      <option value={300}>5 min</option>
                      <option value={600}>10 min</option>
                    </select>
                  </div>
                </div>

                {/* Sound Configuration */}
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/8 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-white/60 uppercase tracking-wider">
                      Alert Sound
                    </span>
                    <button
                      onClick={() => updateConfig({ soundEnabled: !config.soundEnabled })}
                      className={`relative w-8 h-4 rounded-full transition-colors ${
                        config.soundEnabled ? "bg-cyan-500/40" : "bg-white/8"
                      }`}
                    >
                      <motion.div
                        className="absolute top-0.5 w-3 h-3 rounded-full"
                        style={{ backgroundColor: config.soundEnabled ? "#06b6d4" : "rgba(255,255,255,0.2)" }}
                        animate={{ left: config.soundEnabled ? 18 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      />
                    </button>
                  </div>

                  {config.soundEnabled && (
                    <>
                      {/* Volume slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            {config.soundVolume > 0 ? (
                              <Volume2 className="w-3 h-3 text-cyan-400/60" />
                            ) : (
                              <VolumeX className="w-3 h-3 text-white/30" />
                            )}
                            <span className="text-[9px] font-mono text-white/40">Volume</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold text-cyan-400">
                            {Math.round(config.soundVolume * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(config.soundVolume * 100)}
                          onChange={(e) => updateConfig({ soundVolume: parseInt(e.target.value) / 100 })}
                          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer
                            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400
                            [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(6,182,212,0.4)]"
                        />
                      </div>

                      {/* Sound selector grid */}
                      <div className="space-y-1">
                        <span className="text-[9px] font-mono text-white/35 uppercase tracking-wider">
                          Select Sound
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {ALERT_SOUNDS.map((sound) => {
                            const isSelected = config.soundType === sound.id;
                            const isPlaying = playingSound === sound.id;
                            return (
                              <button
                                key={sound.id}
                                onClick={() => updateConfig({ soundType: sound.id })}
                                className={`relative flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all ${
                                  isSelected
                                    ? "bg-cyan-500/15 border border-cyan-500/30"
                                    : "bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10"
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[10px] font-medium truncate ${
                                    isSelected ? "text-cyan-300" : "text-white/60"
                                  }`}>
                                    {sound.label}
                                  </p>
                                  <p className="text-[8px] text-white/25 truncate mt-0.5">
                                    {sound.description}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePreviewSound(sound.id);
                                  }}
                                  className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                                    isPlaying
                                      ? "bg-cyan-500/30 scale-110"
                                      : "bg-white/5 hover:bg-white/10"
                                  }`}
                                  title={`Preview ${sound.label}`}
                                >
                                  <Play className={`w-3 h-3 ${
                                    isPlaying ? "text-cyan-300" : "text-white/40"
                                  }`} />
                                </button>
                                {isSelected && (
                                  <motion.div
                                    layoutId="sound-check"
                                    className="absolute top-1 right-1 w-2 h-2 rounded-full bg-cyan-400"
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Reset */}
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to defaults
                </button>
              </>
            )}
          </div>
        )}

        {showHistory && (
          <div className="space-y-3">
            {history.length === 0 ? (
              <div className="text-center py-12">
                <Bell className="w-8 h-8 text-white/10 mx-auto mb-3" />
                <p className="text-sm text-white/30">No alerts yet</p>
                <p className="text-[10px] text-white/15 mt-1">
                  Alerts will appear here when monitored stations trigger threshold conditions.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-mono text-white/30 uppercase">
                    {history.length} alert{history.length !== 1 ? "s" : ""}
                    {unackCount > 0 && ` · ${unackCount} unread`}
                  </p>
                  <div className="flex items-center gap-2">
                    {unackCount > 0 && (
                      <button
                        onClick={handleAcknowledgeAll}
                        className="flex items-center gap-1 text-[9px] font-mono text-cyan-400/60 hover:text-cyan-400/90 transition-colors"
                      >
                        <Check className="w-3 h-3" />Mark all read
                      </button>
                    )}
                    <button
                      onClick={handleClearHistory}
                      className="flex items-center gap-1 text-[9px] font-mono text-red-400/50 hover:text-red-400/80 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />Clear
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {[...history].reverse().map((event) => {
                    const Icon = alertTypeIcon(event.type);
                    const color = ALERT_TYPE_COLORS[event.type];
                    return (
                      <div
                        key={event.id}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors ${
                          event.acknowledged
                            ? "bg-white/[0.02] border-white/5"
                            : "bg-white/[0.04] border-white/10"
                        }`}
                      >
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                          style={{ backgroundColor: color + "15", border: `1px solid ${color}30` }}
                        >
                          <Icon className="w-3 h-3" style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                              style={{ color, backgroundColor: color + "15" }}
                            >
                              {ALERT_TYPE_LABELS[event.type]}
                            </span>
                            <span
                              className={`text-[8px] font-mono px-1 py-0.5 rounded ${
                                event.severity === "critical"
                                  ? "text-red-400 bg-red-500/10"
                                  : "text-amber-400 bg-amber-500/10"
                              }`}
                            >
                              {event.severity.toUpperCase()}
                            </span>
                            {!event.acknowledged && (
                              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            )}
                          </div>
                          <p className="text-[10px] text-white/60 mt-1 leading-relaxed">
                            {event.message}
                          </p>
                          <p className="text-[8px] font-mono text-white/20 mt-1">
                            {new Date(event.ts).toLocaleString()}
                          </p>
                        </div>
                        {!event.acknowledged && (
                          <button
                            onClick={() => handleAcknowledge(event.id)}
                            className="p-1 rounded hover:bg-white/5 text-white/20 hover:text-white/50 transition-colors shrink-0"
                            title="Mark as read"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ── Sub-components ───────────────────────────────── */

function ToggleRow({
  icon: Icon,
  label,
  description,
  enabled,
  color,
  onToggle,
}: {
  icon: typeof Bell;
  label: string;
  description: string;
  enabled: boolean;
  color: string;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: enabled ? color : "rgba(255,255,255,0.2)" }} />
        <div>
          <p className="text-[10px] text-white/60">{label}</p>
          <p className="text-[8px] text-white/25 mt-0.5">{description}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-8 h-4 rounded-full transition-colors ${
          enabled ? "bg-white/20" : "bg-white/8"
        }`}
      >
        <motion.div
          className="absolute top-0.5 w-3 h-3 rounded-full"
          style={{ backgroundColor: enabled ? color : "rgba(255,255,255,0.2)" }}
          animate={{ left: enabled ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </div>
  );
}
