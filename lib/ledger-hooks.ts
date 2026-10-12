import {appendEntry} from './ledger-server';

// Ledger hooks (owner: WS-05). Phase 0: final signatures with today's behaviour.
// appendMoneyEntry() is how payment, refund, tds_credit and baseline_superseded entries will be
// written (WS-05 exempts them from the plan cap and records them on the current baseline).
// onBaselineApproved() is called by the decision route (WS-02) once a version is approved; WS-05
// writes the baseline_superseded entry there.

export type AppendEntryOptions = Parameters<typeof appendEntry>[0];

/** Phase 0: exactly appendEntry(). */
export function appendMoneyEntry(opts: AppendEntryOptions) {
  return appendEntry(opts);
}

/** Phase 0: no-op. `from` is the approved version being replaced (null for the first approval), `to` the new one. */
export async function onBaselineApproved(_project: string, _from: number | null, _to: number): Promise<void> {}
