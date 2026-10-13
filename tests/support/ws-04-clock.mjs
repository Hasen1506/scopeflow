// WS-04 test clock for a spawned server (NODE_OPTIONS=--import): Date runs WS04_CLOCK_FILE's
// offset (milliseconds) ahead of the real clock, so a test can move the server 61 minutes forward
// without waiting. Timers stay real. Loaded only by tests/ws-04-providers.mjs; never by the app.
// A plain function with every static (parse, UTC, now) as an OWN property: Next 16 wraps Date by
// copying only the constructor's own descriptors, so a `class extends Date` lost Date.parse.
import {readFileSync} from 'node:fs';
const file = process.env.WS04_CLOCK_FILE;
if (file) {
  const Real = Date;
  let cached = 0, at = 0;
  const offset = () => { const t = Real.now(); if (t - at > 20) { at = t; try { cached = Number(readFileSync(file, 'utf8')) || 0; } catch { cached = 0; } } return cached; };
  const now = () => Real.now() + offset();
  function ShiftedDate(...args) {
    if (new.target === undefined) return new Real(now()).toString();
    return Reflect.construct(Real, args.length === 0 ? [now()] : args, new.target === ShiftedDate ? Real : new.target);
  }
  Object.defineProperties(ShiftedDate, Object.getOwnPropertyDescriptors(Real));
  Object.defineProperty(ShiftedDate, 'now', {value: now, writable: true, configurable: true});
  Object.defineProperty(ShiftedDate, 'name', {value: 'Date', configurable: true});
  Object.defineProperty(ShiftedDate, 'length', {value: 7, configurable: true});
  Object.defineProperty(Real.prototype, 'constructor', {value: ShiftedDate, writable: true, configurable: true});
  globalThis.Date = ShiftedDate;
}
