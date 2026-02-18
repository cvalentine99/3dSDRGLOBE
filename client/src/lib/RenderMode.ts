/**
 * RenderMode.ts — Shared render mode state and event bus
 *
 * Central communication channel between WebGLContextManager, FPSGovernor,
 * and FallbackMap. Uses a simple CustomEvent-based pub/sub on `window`.
 */

/** Possible render modes for the application */
export type RenderMode = "webgl" | "fallback";

/** Custom event detail for render mode changes */
export interface RenderModeEventDetail {
  mode: RenderMode;
  reason: string;
  timestamp: number;
}

const RENDER_MODE_EVENT = "sdr-render-mode-change";

let currentMode: RenderMode = "webgl";

/**
 * Get the current render mode.
 * @returns The current RenderMode value
 */
export function getRenderMode(): RenderMode {
  return currentMode;
}

/**
 * Set the render mode and dispatch a change event.
 * @param mode - The new render mode
 * @param reason - Human-readable reason for the change
 */
export function setRenderMode(mode: RenderMode, reason: string): void {
  if (mode === currentMode) return; // No-op if mode unchanged
  const prev = currentMode;
  currentMode = mode;
  const detail: RenderModeEventDetail = {
    mode,
    reason,
    timestamp: Date.now(),
  };
  console.log(
    `[RenderMode] ${prev} → ${mode} | ${reason} | ${new Date(detail.timestamp).toISOString()}`
  );
  window.dispatchEvent(new CustomEvent(RENDER_MODE_EVENT, { detail }));
}

/**
 * Subscribe to render mode changes.
 * @param callback - Called whenever the render mode changes
 * @returns A cleanup function that removes the listener
 */
export function onRenderModeChange(
  callback: (detail: RenderModeEventDetail) => void
): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent<RenderModeEventDetail>).detail);
  };
  window.addEventListener(RENDER_MODE_EVENT, handler);
  return () => window.removeEventListener(RENDER_MODE_EVENT, handler);
}
