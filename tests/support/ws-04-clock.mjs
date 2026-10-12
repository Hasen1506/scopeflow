// WS-04 test clock for a spawned server (NODE_OPTIONS=--import): Date runs WS04_CLOCK_FILE's
// offset (milliseconds) ahead of the real clock, so a test can move the server 61 minutes forward
// without waiting. Timers stay real. Loaded only by tests/ws-04-providers.mjs; never by the app.
import {readFileSync} from 'node:fs';
const file = process.env.WS04_CLOCK_FILE;
if (file) {
  const Real = Date;
  let cached = 0, at = 0;
  const offset = () => { const t = Real.now(); if (t - at > 20) { at = t; try { cached = Number(readFileSync(file, 'utf8')) || 0; } catch { cached = 0; } } return cached; };
  class ShiftedDate extends Real {
    constructor(...args) { if (args.length === 0) super(Real.now() + offset()); else super(...args); }
    static now() { return Real.now() + offset(); }
  }
  globalThis.Date = ShiftedDate;
}
