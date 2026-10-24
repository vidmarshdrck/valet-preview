'use strict';
/** Voice-orb shell. State is display-only and never changes permissions. */
function orbState(s) {
  const x = s || {};
  if (x.error) return 'ERROR';
  if (x.muted) return 'MUTED';
  if (x.processing) return 'PROCESSING';
  if (x.speaking) return 'SPEAKING';
  if (x.listening) return 'LISTENING';
  return 'IDLE';
}
const ACCENT_COUNT = 4;
function cycleAccent(index) {
  const i = Number.isFinite(index) ? index : parseInt(index, 10);
  const cur = Number.isFinite(i) && i >= 0 ? i : 0;
  return (cur + 1) % ACCENT_COUNT;
}
window.orbState = orbState;
window.cycleAccent = cycleAccent;
