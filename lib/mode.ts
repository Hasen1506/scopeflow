import type {Mode} from './contracts';

// Workspace modes (owner: WS-08). Phase 0: every account is in freelancer mode and the defaults are
// today's product. WS-08 stores the mode per account and fills modeDefaults() (plan §7). A mode
// changes defaults and ordering only; it never removes a feature.

export type {Mode};
export const MODES: readonly Mode[] = ['freelancer', 'agency', 'consumer', 'enterprise'];

export type ModeDefaults = {
  mode: Mode;
  /** Compliance features (retention, audit export, countersign roles) on by default. */
  compliance: boolean;
};

/** The mode of `owner`'s workspace. Phase 0: always freelancer. */
export async function currentMode(_owner: string): Promise<Mode> {
  return 'freelancer';
}

/** Defaults a mode sets. Phase 0: today's defaults for every mode. */
export function modeDefaults(mode: Mode): ModeDefaults {
  return {mode, compliance: false};
}
