import type {EsignProvider} from './types';
import {leegality, leegalityConfig} from './leegality';
import {doubleAllowed, esignDouble} from './double';
export type {EsignProvider, EsignRequest, EsignCreated, EsignCompletion} from './types';
export {EsignUnavailable} from './types';

// SF-15: the eSign provider selected by SCOPEFLOW_ESIGN_PROVIDER (leegality | double), or null when off.
type Env = Record<string, string | undefined>;
export function esignProvider(env: Env = process.env, name = env.SCOPEFLOW_ESIGN_PROVIDER): EsignProvider | null {
  if (name === 'leegality') return leegalityConfig(env) ? leegality(env) : null;
  if (name === 'double') return doubleAllowed(env) ? esignDouble(env) : null;
  return null;
}
