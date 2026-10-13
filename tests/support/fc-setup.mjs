// Single source of fast-check's global configuration for test:props (property, differential, golden).
// Loaded twice on purpose, both idempotent: via `node --import` in the npm script, and by an import at
// the top of every suite that uses fast-check, so a file run on its own (`node --test <file>`) is
// seeded the same way.
//   FC_SEED  fixed default; set it to explore other random runs, or to replay a failure's printed seed.
//   FC_RUNS  default numRuns for properties that do not pass their own.
import fc from 'fast-check';

export const SEED = Number(process.env.FC_SEED ?? 20261007);
export const RUNS = Number(process.env.FC_RUNS ?? 100);
fc.configureGlobal({seed: SEED, numRuns: RUNS, endOnFailure: true});
export {fc};
