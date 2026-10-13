'use client';
import {useEffect, useState} from 'react';
// WS-10 request (SF-14): the owner's analytics opt-out, PATCH /api/analytics {opt_out}. Guarded:
// renders nothing until WS-10's /api/analytics answers with an opted_out flag (it is not on every
// server), so the Account page never shows a switch that cannot work.
export default function AnalyticsToggle() {
  const [state, setState] = useState<{enabled: boolean; opted_out: boolean} | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/analytics', {headers: {Accept: 'application/json'}}).then(r => (r.ok ? r.json() : null)).then(d => { if (live && d && typeof d.opted_out === 'boolean') setState({enabled: !!d.enabled, opted_out: d.opted_out}); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!state) return null;
  async function toggle(optOut: boolean) {
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/analytics', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({opt_out: optOut})});
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      setState(s => (s ? {...s, opted_out: !!d.opted_out} : s));
      setNote(d.opted_out ? 'Product analytics are off for this account; recorded events were deleted.' : 'Product analytics are on again.');
    } catch (e) { setNote((e as Error).message); } finally { setBusy(false); }
  }
  return <section aria-labelledby="h-analytics"><h2 id="h-analytics">Product analytics</h2>
    <p className="fine">ScopeFlow counts funnel steps (for example “scope sent”, “approved”) per account to improve the product. No scope content, client names or emails are recorded.</p>
    <label className="radio-row"><input type="checkbox" checked={!state.opted_out} disabled={busy} onChange={e => void toggle(!e.target.checked)}/> Share product analytics from this account</label>
    {note && <p role="status" className="fine">{note}</p>}
  </section>;
}
