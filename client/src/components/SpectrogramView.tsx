/**
 * SpectrogramView.tsx — Canvas-based spectrogram/waterfall visualization
 *
 * Fetches a WAV audio file, performs FFT analysis using the Web Audio API,
 * and renders a spectrogram (frequency vs time) with a configurable color map.
 *
 * Designed for short KiwiSDR recordings (10-30 seconds).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ZoomIn, ZoomOut, Palette } from "lucide-react";

/* ── Types ────────────────────────────────────────── */

interface SpectrogramViewProps {
  /** URL to the WAV audio file */
  audioUrl: string;
  /** Height of the spectrogram canvas in pixels */
  height?: number;
  /** Optional label for the spectrogram */
  label?: string;
}

type ColorMap = "inferno" | "viridis" | "plasma" | "grayscale";

/* ── Color Maps ──────────────────────────────────── */

function infernoColor(t: number): [number, number, number] {
  // Simplified inferno-like colormap
  if (t < 0.25) {
    const s = t / 0.25;
    return [Math.floor(s * 80), Math.floor(s * 10), Math.floor(40 + s * 100)];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [Math.floor(80 + s * 140), Math.floor(10 + s * 30), Math.floor(140 - s * 40)];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [Math.floor(220 + s * 35), Math.floor(40 + s * 120), Math.floor(100 - s * 80)];
  } else {
    const s = (t - 0.75) / 0.25;
    return [255, Math.floor(160 + s * 80), Math.floor(20 + s * 180)];
  }
}

function viridisColor(t: number): [number, number, number] {
  if (t < 0.25) {
    const s = t / 0.25;
    return [Math.floor(68 - s * 20), Math.floor(1 + s * 50), Math.floor(84 + s * 60)];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [Math.floor(48 - s * 15), Math.floor(51 + s * 60), Math.floor(144 - s * 10)];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [Math.floor(33 + s * 90), Math.floor(111 + s * 60), Math.floor(134 - s * 50)];
  } else {
    const s = (t - 0.75) / 0.25;
    return [Math.floor(123 + s * 130), Math.floor(171 + s * 60), Math.floor(84 - s * 60)];
  }
}

function plasmaColor(t: number): [number, number, number] {
  if (t < 0.25) {
    const s = t / 0.25;
    return [Math.floor(13 + s * 90), Math.floor(8 - s * 5), Math.floor(135 + s * 30)];
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return [Math.floor(103 + s * 100), Math.floor(3 + s * 10), Math.floor(165 - s * 30)];
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return [Math.floor(203 + s * 40), Math.floor(13 + s * 80), Math.floor(135 - s * 60)];
  } else {
    const s = (t - 0.75) / 0.25;
    return [Math.floor(243 + s * 12), Math.floor(93 + s * 100), Math.floor(75 - s * 50)];
  }
}

function grayscaleColor(t: number): [number, number, number] {
  const v = Math.floor(t * 255);
  return [v, v, v];
}

function getColorFn(map: ColorMap): (t: number) => [number, number, number] {
  switch (map) {
    case "inferno": return infernoColor;
    case "viridis": return viridisColor;
    case "plasma": return plasmaColor;
    case "grayscale": return grayscaleColor;
  }
}

/* ── FFT Parameters ──────────────────────────────── */

const FFT_SIZE = 1024;
const MIN_DB = -100;
const MAX_DB = -20;

/* ── Component ───────────────────────────────────── */

export default function SpectrogramView({
  audioUrl,
  height = 160,
  label,
}: SpectrogramViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [colorMap, setColorMap] = useState<ColorMap>("inferno");
  const [zoom, setZoom] = useState(1);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [cursorTime, setCursorTime] = useState<number | null>(null);
  const [cursorFreq, setCursorFreq] = useState<number | null>(null);

  // Fetch and decode audio
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        audioCtx.close();

        if (!cancelled) {
          setAudioBuffer(decoded);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load audio");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [audioUrl]);

  // Render spectrogram when buffer or settings change
  useEffect(() => {
    if (!audioBuffer || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const hopSize = FFT_SIZE / 4; // 75% overlap
    const numFrames = Math.floor((channelData.length - FFT_SIZE) / hopSize);

    if (numFrames <= 0) {
      setError("Audio too short for spectrogram");
      return;
    }

    // Set canvas dimensions
    const displayWidth = Math.floor(numFrames * zoom);
    const freqBins = FFT_SIZE / 2;
    canvas.width = displayWidth;
    canvas.height = height;

    const colorFn = getColorFn(colorMap);

    // Create an OfflineAudioContext for analysis
    const imageData = ctx.createImageData(displayWidth, height);

    // Perform FFT analysis frame by frame
    const fftData = new Float32Array(freqBins);
    const windowFn = new Float32Array(FFT_SIZE);

    // Hann window
    for (let i = 0; i < FFT_SIZE; i++) {
      windowFn[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
    }

    // Compute magnitude spectrum for each frame
    const spectrumData: Float32Array[] = [];
    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * hopSize;
      const real = new Float32Array(FFT_SIZE);
      const imag = new Float32Array(FFT_SIZE);

      // Apply window and copy samples
      for (let i = 0; i < FFT_SIZE; i++) {
        real[i] = (channelData[offset + i] || 0) * windowFn[i];
        imag[i] = 0;
      }

      // In-place FFT (Cooley-Tukey radix-2)
      fft(real, imag, FFT_SIZE);

      // Compute magnitude in dB
      const magnitudes = new Float32Array(freqBins);
      for (let i = 0; i < freqBins; i++) {
        const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / FFT_SIZE;
        magnitudes[i] = 20 * Math.log10(Math.max(mag, 1e-10));
      }
      spectrumData.push(magnitudes);
    }

    // Render to canvas
    for (let x = 0; x < displayWidth; x++) {
      const frameIdx = Math.floor((x / displayWidth) * numFrames);
      const spectrum = spectrumData[Math.min(frameIdx, spectrumData.length - 1)];

      for (let y = 0; y < height; y++) {
        // Map y to frequency bin (bottom = low freq, top = high freq)
        const freqBinIdx = Math.floor(((height - 1 - y) / (height - 1)) * (freqBins - 1));
        const dbValue = spectrum[freqBinIdx];

        // Normalize to 0-1 range
        const normalized = Math.max(0, Math.min(1, (dbValue - MIN_DB) / (MAX_DB - MIN_DB)));

        const [r, g, b] = colorFn(normalized);
        const pixelIdx = (y * displayWidth + x) * 4;
        imageData.data[pixelIdx] = r;
        imageData.data[pixelIdx + 1] = g;
        imageData.data[pixelIdx + 2] = b;
        imageData.data[pixelIdx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw frequency axis labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    const maxFreq = sampleRate / 2;
    const freqSteps = [0, 0.25, 0.5, 0.75, 1];
    for (const step of freqSteps) {
      const freq = step * maxFreq;
      const yPos = height - step * height;
      const freqLabel = freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${Math.round(freq)}`;
      ctx.fillText(freqLabel, 3, yPos - 2);
      // Thin gridline
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yPos);
      ctx.lineTo(displayWidth, yPos);
      ctx.stroke();
    }

    // Draw time axis labels
    ctx.textAlign = "center";
    const duration = audioBuffer.duration;
    const timeSteps = Math.min(8, Math.ceil(duration));
    for (let i = 0; i <= timeSteps; i++) {
      const t = (i / timeSteps) * duration;
      const xPos = (i / timeSteps) * displayWidth;
      ctx.fillText(`${t.toFixed(1)}s`, xPos, height - 2);
    }
  }, [audioBuffer, colorMap, zoom, height]);

  // Mouse hover handler for cursor info
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!audioBuffer || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const canvasWidth = canvasRef.current.width;
      const canvasHeight = canvasRef.current.height;

      const time = (x / rect.width) * audioBuffer.duration;
      const freq = ((canvasHeight - (y / rect.height) * canvasHeight) / canvasHeight) * (audioBuffer.sampleRate / 2);

      setCursorTime(time);
      setCursorFreq(freq);
    },
    [audioBuffer]
  );

  const handleMouseLeave = useCallback(() => {
    setCursorTime(null);
    setCursorFreq(null);
  }, []);

  const cycleColorMap = useCallback(() => {
    const maps: ColorMap[] = ["inferno", "viridis", "plasma", "grayscale"];
    const idx = maps.indexOf(colorMap);
    setColorMap(maps[(idx + 1) % maps.length]);
  }, [colorMap]);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-black/30 border border-white/5"
        style={{ height }}
      >
        <Loader2 className="w-4 h-4 text-white/30 animate-spin mr-2" />
        <span className="text-[10px] text-white/30">Generating spectrogram...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-red-500/5 border border-red-500/10"
        style={{ height: 40 }}
      >
        <span className="text-[10px] text-red-400/60">Spectrogram error: {error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {label && (
            <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">
              {label}
            </span>
          )}
          {cursorTime !== null && cursorFreq !== null && (
            <span className="text-[9px] font-mono text-cyan-400/60">
              {cursorTime.toFixed(2)}s · {cursorFreq >= 1000 ? `${(cursorFreq / 1000).toFixed(2)} kHz` : `${Math.round(cursorFreq)} Hz`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
            className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[8px] font-mono text-white/30 w-6 text-center">{zoom}x</span>
          <button
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={cycleColorMap}
            className="w-5 h-5 rounded flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors ml-1"
            title={`Color map: ${colorMap}`}
          >
            <Palette className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Spectrogram canvas */}
      <div
        className="rounded-md overflow-hidden border border-white/5 relative"
        style={{ height, overflowX: "auto" }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{ height: "100%", imageRendering: "pixelated" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
}

/* ── FFT Implementation (Cooley-Tukey radix-2 DIT) ── */

function fft(real: Float32Array, imag: Float32Array, n: number): void {
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let temp = real[i];
      real[i] = real[j];
      real[j] = temp;
      temp = imag[i];
      imag[i] = imag[j];
      imag[j] = temp;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;

      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + halfLen;

        const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
        const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] += tReal;
        imag[evenIdx] += tImag;

        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }
}
