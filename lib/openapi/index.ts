import type {OpenApiFragment} from './types';
import {fragment as ws01} from './ws-01';
import {fragment as ws02} from './ws-02';
import {fragment as ws03} from './ws-03';
import {fragment as ws04} from './ws-04';
import {fragment as ws05} from './ws-05';
import {fragment as ws06} from './ws-06';
import {fragment as ws07} from './ws-07';
import {fragment as ws08} from './ws-08';
import {fragment as ws09} from './ws-09';
import {fragment as ws10} from './ws-10';

// The workstream fragments, merged into the document by app/api/openapi/route.ts after the paths
// and schemas already there. All fragments are empty in Phase 0, so the document is unchanged.
export type {OpenApiFragment};
export const fragments: readonly OpenApiFragment[] = [ws01, ws02, ws03, ws04, ws05, ws06, ws07, ws08, ws09, ws10];

/** `base` with every fragment's entries appended; a key already present (in base or an earlier fragment) is an error. */
export function mergeFragments(base: Record<string, unknown>, pick: (f: OpenApiFragment) => Record<string, unknown>, list: readonly OpenApiFragment[] = fragments): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const f of list) for (const [k, v] of Object.entries(pick(f))) {
    if (k in out) throw new Error(`OpenAPI fragment redefines ${k}`);
    out[k] = v;
  }
  return out;
}
