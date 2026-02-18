/**
 * WebGLContextManager.ts — WebGL context loss/restore handling
 *
 * Attaches webglcontextlost and webglcontextrestored listeners to the
 * renderer canvas. On loss, pauses the animation loop and triggers
 * fallback mode. On restore, re-initializes the Three.js renderer and
 * resumes rendering. If restore never fires within a timeout, permanently
 * switches to the 2D fallback.
 */
import * as THREE from "three";
import { setRenderMode } from "./RenderMode";

/** Callback signatures for the context manager */
export interface WebGLContextManagerCallbacks {
  /** Called when context is lost — must cancel the RAF loop */
  onContextLost: () => void;
  /** Called when context is restored — must restart the RAF loop with the new renderer */
  onContextRestored: (renderer: THREE.WebGLRenderer) => void;
  /** Called when restore times out and fallback becomes permanent */
  onPermanentFallback: () => void;
}

/** Configuration for the context manager */
export interface WebGLContextManagerConfig {
  /** Timeout in ms before giving up on context restoration (default: 10000) */
  restoreTimeoutMs?: number;
}

const DEFAULT_RESTORE_TIMEOUT_MS = 10_000;

/**
 * Manages WebGL context loss and restoration for a Three.js renderer.
 *
 * Usage:
 * ```ts
 * const mgr = new WebGLContextManager(renderer, canvas, {
 *   onContextLost: () => cancelAnimationFrame(animId),
 *   onContextRestored: (r) => { renderer = r; startLoop(); },
 *   onPermanentFallback: () => showFallback(),
 * });
 * // On unmount:
 * mgr.dispose();
 * ```
 */
export class WebGLContextManager {
  private canvas: HTMLCanvasElement;
  private callbacks: WebGLContextManagerCallbacks;
  private restoreTimeoutMs: number;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private isContextLost = false;
  private isPermanentFallback = false;
  private boundOnLost: (e: Event) => void;
  private boundOnRestored: (e: Event) => void;
  private rendererOptions: THREE.WebGLRendererParameters;

  constructor(
    renderer: THREE.WebGLRenderer,
    callbacks: WebGLContextManagerCallbacks,
    config?: WebGLContextManagerConfig
  ) {
    this.canvas = renderer.domElement;
    this.callbacks = callbacks;
    this.restoreTimeoutMs =
      config?.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;

    // Capture renderer options for re-creation on restore
    this.rendererOptions = {
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    };

    this.boundOnLost = this.handleContextLost.bind(this);
    this.boundOnRestored = this.handleContextRestored.bind(this);

    this.canvas.addEventListener("webglcontextlost", this.boundOnLost);
    this.canvas.addEventListener("webglcontextrestored", this.boundOnRestored);
  }

  /** Whether the WebGL context is currently lost */
  get contextLost(): boolean {
    return this.isContextLost;
  }

  /** Whether we permanently switched to fallback */
  get permanentFallback(): boolean {
    return this.isPermanentFallback;
  }

  private handleContextLost(e: Event): void {
    e.preventDefault(); // Enable context restoration
    this.isContextLost = true;

    console.warn(
      `[WebGLContextManager] Context lost at ${new Date().toISOString()}`
    );

    // Pause animation loop
    this.callbacks.onContextLost();

    // Switch to fallback mode
    setRenderMode("fallback", "WebGL context lost");

    // Set timeout for permanent fallback if restore never fires
    this.restoreTimer = setTimeout(() => {
      if (this.isContextLost && !this.isPermanentFallback) {
        console.error(
          "[WebGLContextManager] Context restore timed out — switching to permanent fallback"
        );
        this.isPermanentFallback = true;
        this.callbacks.onPermanentFallback();
      }
    }, this.restoreTimeoutMs);
  }

  private handleContextRestored(_e: Event): void {
    if (this.isPermanentFallback) return;

    // Clear the restore timeout
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }

    console.log(
      `[WebGLContextManager] Context restored at ${new Date().toISOString()}`
    );

    this.isContextLost = false;

    // Re-create the renderer on the same canvas
    // NOTE: Three.js textures/geometries uploaded to the old context are lost.
    // The caller must re-upload them via onContextRestored callback.
    try {
      const newRenderer = new THREE.WebGLRenderer(this.rendererOptions);
      setRenderMode("webgl", "WebGL context restored");
      this.callbacks.onContextRestored(newRenderer);
    } catch (err) {
      console.error(
        "[WebGLContextManager] Failed to re-create renderer after restore:",
        err
      );
      this.isPermanentFallback = true;
      this.callbacks.onPermanentFallback();
    }
  }

  /**
   * Remove all event listeners and clear pending timers.
   * Call this on component unmount.
   */
  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.boundOnLost);
    this.canvas.removeEventListener(
      "webglcontextrestored",
      this.boundOnRestored
    );
    if (this.restoreTimer !== null) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }
}
