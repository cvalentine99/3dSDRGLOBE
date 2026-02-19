/**
 * fingerprintExtractor.ts — Client-side signal fingerprint extraction
 *
 * Extracts spectral features from audio data for signal fingerprinting.
 * Uses Web Audio API for FFT analysis and generates a compact feature vector
 * that can be compared via cosine similarity for target matching.
 */

export interface SignalFingerprint {
  /** Dominant spectral peaks (Hz) */
  spectralPeaks: number[];
  /** Estimated signal bandwidth (Hz) */
  bandwidthHz: number;
  /** Dominant frequency (Hz) */
  dominantFreqHz: number;
  /** Spectral centroid (Hz) - "center of mass" of the spectrum */
  spectralCentroid: number;
  /** Spectral flatness (0-1) - 1 = noise-like, 0 = tonal */
  spectralFlatness: number;
  /** RMS level (dB) */
  rmsLevel: number;
  /** Compact feature vector for cosine similarity matching */
  featureVector: number[];
}

/**
 * Extract a signal fingerprint from a WAV audio URL.
 * Fetches the audio, decodes it, and computes spectral features.
 */
export async function extractFingerprint(audioUrl: string): Promise<SignalFingerprint> {
  // Fetch and decode audio
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
    sampleRate: 12000, // KiwiSDR typical sample rate
  });

  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  // Compute FFT
  const fftSize = 2048;
  const spectrum = computeFFT(channelData, fftSize);
  const freqBinWidth = sampleRate / fftSize;

  // Find spectral peaks
  const peaks = findSpectralPeaks(spectrum, freqBinWidth, 10);

  // Compute spectral centroid
  let weightedSum = 0;
  let totalMag = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const freq = i * freqBinWidth;
    weightedSum += freq * spectrum[i];
    totalMag += spectrum[i];
  }
  const spectralCentroid = totalMag > 0 ? weightedSum / totalMag : 0;

  // Compute spectral flatness (geometric mean / arithmetic mean)
  const logSum = spectrum.reduce((sum, val) => sum + Math.log(Math.max(val, 1e-10)), 0);
  const geometricMean = Math.exp(logSum / spectrum.length);
  const arithmeticMean = totalMag / spectrum.length;
  const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

  // Compute bandwidth (frequency range containing 90% of energy)
  const sortedEnergy = spectrum.map((mag, i) => ({ freq: i * freqBinWidth, energy: mag * mag }));
  const totalEnergy = sortedEnergy.reduce((sum, e) => sum + e.energy, 0);
  let cumEnergy = 0;
  let lowFreq = 0;
  let highFreq = sampleRate / 2;
  for (const e of sortedEnergy) {
    cumEnergy += e.energy;
    if (cumEnergy >= totalEnergy * 0.05 && lowFreq === 0) {
      lowFreq = e.freq;
    }
    if (cumEnergy >= totalEnergy * 0.95) {
      highFreq = e.freq;
      break;
    }
  }
  const bandwidthHz = highFreq - lowFreq;

  // Dominant frequency
  const dominantFreqHz = peaks.length > 0 ? peaks[0].freq : 0;

  // Compute RMS level
  let sumSquares = 0;
  for (let i = 0; i < channelData.length; i++) {
    sumSquares += channelData[i] * channelData[i];
  }
  const rms = Math.sqrt(sumSquares / channelData.length);
  const rmsLevel = 20 * Math.log10(Math.max(rms, 1e-10));

  // Build feature vector (32-dimensional)
  // Combines: 16 mel-scale spectral bins + 8 peak frequencies + 4 statistics + 4 temporal features
  const featureVector = buildFeatureVector(spectrum, freqBinWidth, sampleRate, peaks, {
    spectralCentroid,
    spectralFlatness,
    bandwidthHz,
    rmsLevel,
  }, channelData);

  audioCtx.close();

  return {
    spectralPeaks: peaks.map((p) => p.freq),
    bandwidthHz,
    dominantFreqHz,
    spectralCentroid,
    spectralFlatness,
    rmsLevel,
    featureVector,
  };
}

/** Compute magnitude spectrum using a simple DFT (for small windows) or averaged FFT */
function computeFFT(samples: Float32Array, fftSize: number): number[] {
  const numFrames = Math.floor(samples.length / fftSize);
  const halfSize = fftSize / 2;
  const avgSpectrum = new Float64Array(halfSize);

  // Hann window
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const frames = Math.max(numFrames, 1);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * fftSize;
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      const idx = offset + i;
      real[i] = (idx < samples.length ? samples[idx] : 0) * window[i];
    }

    // Cooley-Tukey FFT
    fftInPlace(real, imag);

    for (let i = 0; i < halfSize; i++) {
      avgSpectrum[i] += Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / frames;
    }
  }

  return Array.from(avgSpectrum);
}

/** In-place Cooley-Tukey FFT (radix-2) */
function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
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
        const tReal = curReal * real[i + k + halfLen] - curImag * imag[i + k + halfLen];
        const tImag = curReal * imag[i + k + halfLen] + curImag * real[i + k + halfLen];
        real[i + k + halfLen] = real[i + k] - tReal;
        imag[i + k + halfLen] = imag[i + k] - tImag;
        real[i + k] += tReal;
        imag[i + k] += tImag;
        const newReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newReal;
      }
    }
  }
}

/** Find spectral peaks using a simple peak-picking algorithm */
function findSpectralPeaks(
  spectrum: number[],
  freqBinWidth: number,
  maxPeaks: number
): Array<{ freq: number; magnitude: number }> {
  const peaks: Array<{ freq: number; magnitude: number; index: number }> = [];

  for (let i = 2; i < spectrum.length - 2; i++) {
    if (
      spectrum[i] > spectrum[i - 1] &&
      spectrum[i] > spectrum[i + 1] &&
      spectrum[i] > spectrum[i - 2] &&
      spectrum[i] > spectrum[i + 2]
    ) {
      peaks.push({
        freq: i * freqBinWidth,
        magnitude: spectrum[i],
        index: i,
      });
    }
  }

  // Sort by magnitude descending
  peaks.sort((a, b) => b.magnitude - a.magnitude);

  return peaks.slice(0, maxPeaks).map(({ freq, magnitude }) => ({ freq, magnitude }));
}

/** Build a 32-dimensional feature vector for cosine similarity matching */
function buildFeatureVector(
  spectrum: number[],
  freqBinWidth: number,
  sampleRate: number,
  peaks: Array<{ freq: number; magnitude: number }>,
  stats: {
    spectralCentroid: number;
    spectralFlatness: number;
    bandwidthHz: number;
    rmsLevel: number;
  },
  samples: Float32Array
): number[] {
  const vector: number[] = [];

  // 16 mel-scale spectral bins
  const maxFreq = sampleRate / 2;
  const melBins = 16;
  const melMax = 2595 * Math.log10(1 + maxFreq / 700);
  for (let b = 0; b < melBins; b++) {
    const melLow = (melMax * b) / melBins;
    const melHigh = (melMax * (b + 1)) / melBins;
    const freqLow = 700 * (Math.pow(10, melLow / 2595) - 1);
    const freqHigh = 700 * (Math.pow(10, melHigh / 2595) - 1);
    const binLow = Math.floor(freqLow / freqBinWidth);
    const binHigh = Math.min(Math.ceil(freqHigh / freqBinWidth), spectrum.length - 1);

    let energy = 0;
    for (let i = binLow; i <= binHigh; i++) {
      energy += spectrum[i] * spectrum[i];
    }
    vector.push(Math.sqrt(energy));
  }

  // 8 peak frequencies (normalized to Nyquist)
  for (let i = 0; i < 8; i++) {
    vector.push(i < peaks.length ? peaks[i].freq / maxFreq : 0);
  }

  // 4 statistics (normalized)
  vector.push(stats.spectralCentroid / maxFreq);
  vector.push(stats.spectralFlatness);
  vector.push(Math.min(stats.bandwidthHz / maxFreq, 1));
  vector.push(Math.max(0, (stats.rmsLevel + 60) / 60)); // Normalize dB to 0-1 range

  // 4 temporal features
  // Zero-crossing rate
  let zeroCrossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  vector.push(zeroCrossings / samples.length);

  // Short-time energy variance
  const frameSize = 256;
  const energies: number[] = [];
  for (let i = 0; i < samples.length - frameSize; i += frameSize) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) {
      e += samples[i + j] * samples[i + j];
    }
    energies.push(e / frameSize);
  }
  const meanEnergy = energies.reduce((s, e) => s + e, 0) / (energies.length || 1);
  const energyVariance =
    energies.reduce((s, e) => s + (e - meanEnergy) * (e - meanEnergy), 0) / (energies.length || 1);
  vector.push(Math.min(Math.sqrt(energyVariance) / (meanEnergy + 1e-10), 1));

  // Crest factor
  let peakAmp = 0;
  let rmsSum = 0;
  for (let i = 0; i < samples.length; i++) {
    peakAmp = Math.max(peakAmp, Math.abs(samples[i]));
    rmsSum += samples[i] * samples[i];
  }
  const rmsVal = Math.sqrt(rmsSum / samples.length);
  vector.push(rmsVal > 0 ? Math.min(peakAmp / rmsVal / 10, 1) : 0);

  // Spectral rolloff (frequency below which 85% of energy is concentrated)
  const totalEnergy = spectrum.reduce((s, v) => s + v * v, 0);
  let cumEnergy = 0;
  let rolloff = 0;
  for (let i = 0; i < spectrum.length; i++) {
    cumEnergy += spectrum[i] * spectrum[i];
    if (cumEnergy >= totalEnergy * 0.85) {
      rolloff = i * freqBinWidth;
      break;
    }
  }
  vector.push(rolloff / maxFreq);

  // Normalize the entire vector
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    return vector.map((v) => v / norm);
  }
  return vector;
}
