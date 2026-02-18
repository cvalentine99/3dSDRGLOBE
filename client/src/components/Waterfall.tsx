/**
 * Waterfall.tsx — Canvas-based spectrum waterfall display
 *
 * Renders real-time FFT data from an SDR receiver as a scrolling
 * spectrogram. Each new row of FFT bins is painted at the top and
 * previous rows scroll downward.
 *
 * Color mapping: dark blue (noise floor) → cyan → green → yellow → red (strong signal)
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { KiwiClient, type WaterfallRow } from "@/lib/kiwiClient";
import { Radio, ExternalLink, Loader2, WifiOff } from "lucide-react";

/* ── Color LUT ──────────────────────────────────────────── */

/** Pre-compute a 256-entry color lookup table (RGBA for each dB level). */
function buildColorLut(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; // 0 = noise floor, 1 = max signal
    let r: number, g: number, b: number;

    if (t < 0.2) {
      // Deep blue → blue
      const s = t / 0.2;
      r = 0; g = 0; b = Math.floor(40 + 120 * s);
    } else if (t < 0.4) {
      // Blue → cyan
      const s = (t - 0.2) / 0.2;
      r = 0; g = Math.floor(180 * s); b = Math.floor(160 + 40 * s);
    } else if (t < 0.6) {
      // Cyan → green
      const s = (t - 0.4) / 0.2;
      r = 0; g = Math.floor(180 + 75 * s); b = Math.floor(200 * (1 - s));
    } else if (t < 0.8) {
      // Green → yellow
      const s = (t - 0.6) / 0.2;
      r = Math.floor(255 * s); g = 255; b = 0;
    } else {
      // Yellow → red
      const s = (t - 0.8) / 0.2;
      r = 255; g = Math.floor(255 * (1 - s)); b = 0;
    }

    // Pack as ABGR (little-endian RGBA for Uint32Array on ImageData)
    lut[i] = (255 << 24) | (b << 16) | (g << 8) | r;
  }
  return lut;
}

const COLOR_LUT = buildColorLut();

/* ── Props ──────────────────────────────────────────────── */

interface WaterfallProps {
  receiverUrl: string;
  /** Height in CSS pixels. Omit to fill parent (100%). */
  height?: number;
  /** Original HTTP URL for "open in tab" fallback */
  fallbackUrl?: string;
}

/* ── Component ──────────────────────────────────────────── */

type ConnectionState = "connecting" | "connected" | "failed" | "closed";

export default function Waterfall({ receiverUrl, height = 400, fallbackUrl }: WaterfallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clientRef = useRef<KiwiClient | null>(null);
  const rowBufferRef = useRef<Uint8Array[]>([]);
  const animFrameRef = useRef<number>(0);
  const [connState, setConnState] = useState<ConnectionState>("connecting");

  /** Paint buffered waterfall rows onto the canvas. Called per animation frame. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rows = rowBufferRef.current;
    if (rows.length === 0) {
      animFrameRef.current = requestAnimationFrame(paint);
      return;
    }

    // Drain the buffer
    const batch = rows.splice(0, rows.length);
    const w = canvas.width;
    const h = canvas.height;

    // Scroll existing content down by batch.length rows
    if (batch.length < h) {
      const existing = ctx.getImageData(0, 0, w, h - batch.length);
      ctx.putImageData(existing, 0, batch.length);
    }

    // Paint new rows at the top
    for (let rowIdx = 0; rowIdx < batch.length && rowIdx < h; rowIdx++) {
      const bins = batch[rowIdx];
      const imgData = ctx.createImageData(w, 1);
      const pixels = new Uint32Array(imgData.data.buffer);

      // Map FFT bins → canvas pixels (bins may differ from canvas width)
      const binCount = bins.length;
      for (let x = 0; x < w; x++) {
        const binIdx = Math.floor((x / w) * binCount);
        const val = bins[binIdx] ?? 0;
        pixels[x] = COLOR_LUT[val];
      }

      ctx.putImageData(imgData, 0, rowIdx);
    }

    animFrameRef.current = requestAnimationFrame(paint);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size the canvas to its CSS layout size (1:1 for crisp pixels)
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);

    // Clear to dark background
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#0a0e1a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Connect to KiwiSDR
    const client = new KiwiClient(receiverUrl);
    clientRef.current = client;
    setConnState("connecting");

    client.on("open", () => setConnState("connected"));
    client.on("close", () => setConnState("closed"));
    client.on("error", () => setConnState("failed"));

    client.on("waterfall", (row: WaterfallRow) => {
      // Buffer rows — the paint loop drains them at screen refresh rate
      rowBufferRef.current.push(row.bins);
      // Cap buffer to prevent memory buildup if painting falls behind
      if (rowBufferRef.current.length > 120) {
        rowBufferRef.current.splice(0, rowBufferRef.current.length - 60);
      }
    });

    client.connect();

    // Start paint loop
    animFrameRef.current = requestAnimationFrame(paint);

    return () => {
      client.disconnect();
      clientRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
      rowBufferRef.current = [];
    };
  }, [receiverUrl, paint]);

  return (
    <div className="relative w-full" style={{ height: height ?? "100%" }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: "pixelated" }}
      />

      {/* Connection status overlay */}
      {connState === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-xs font-mono text-white/70">Connecting to receiver...</p>
        </div>
      )}

      {(connState === "failed" || connState === "closed") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm gap-3">
          <WifiOff className="w-8 h-8 text-red-400/70" />
          <p className="text-xs font-mono text-white/60">
            {connState === "failed" ? "Connection failed" : "Connection closed"}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                clientRef.current?.disconnect();
                const client = new KiwiClient(receiverUrl);
                clientRef.current = client;
                setConnState("connecting");
                client.on("open", () => setConnState("connected"));
                client.on("close", () => setConnState("closed"));
                client.on("error", () => setConnState("failed"));
                client.on("waterfall", (row: WaterfallRow) => {
                  rowBufferRef.current.push(row.bins);
                  if (rowBufferRef.current.length > 120) {
                    rowBufferRef.current.splice(0, rowBufferRef.current.length - 60);
                  }
                });
                client.connect();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-white/70 hover:bg-white/15 transition-all text-[10px] font-mono"
            >
              <Radio className="w-3 h-3" />
              Retry
            </button>
            {fallbackUrl && (
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 transition-all text-[10px] font-mono"
              >
                <ExternalLink className="w-3 h-3" />
                Open in Tab
              </a>
            )}
          </div>
        </div>
      )}

      {/* Frequency ruler hint */}
      {connState === "connected" && (
        <div className="absolute bottom-0 left-0 right-0 h-5 bg-gradient-to-t from-black/50 to-transparent pointer-events-none flex items-end justify-between px-2 pb-0.5">
          <span className="text-[8px] font-mono text-white/30">0 kHz</span>
          <span className="text-[8px] font-mono text-white/30">30 MHz</span>
        </div>
      )}
    </div>
  );
}
