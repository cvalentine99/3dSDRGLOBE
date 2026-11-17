/**
 * Deep-space backdrop drawn behind the globe canvas.
 * Pure CSS so the page has no external image dependency; the Three.js
 * starfield provides the stars.
 */
export const SPACE_BG =
  "radial-gradient(ellipse at 28% 22%, rgba(48, 86, 150, 0.35) 0%, transparent 55%), " +
  "radial-gradient(ellipse at 78% 78%, rgba(24, 110, 130, 0.25) 0%, transparent 50%), " +
  "linear-gradient(180deg, #03060c 0%, #060b16 100%)";
