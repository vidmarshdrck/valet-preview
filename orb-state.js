'use strict';
/** Voice-orb shell. State is display-only and never changes permissions. */
function orbState(s) {
  const x = s || {};
  if (x.error) return 'error';
  if (x.processing) return 'processing';
  if (x.muted) return 'muted';
  if (x.speaking) return 'speaking';
  if (x.listening) return 'listening';
  return 'idle';
}
const ACCENT_COUNT = 4;
function cycleAccent(index) {
  const i = Number.isFinite(index) ? index : parseInt(index, 10);
  const cur = Number.isFinite(i) && i >= 0 ? i : 0;
  return (cur + 1) % ACCENT_COUNT;
}
window.orbState = orbState;
window.cycleAccent = cycleAccent;
