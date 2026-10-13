'use client';
import {useMemo, useState} from 'react';
import {msmedDueDates, msmedInterest, MSMED_DISCLAIMER, type RateBasis} from '@/lib/msmed';
import {formatMoney} from '@/lib/currency';

/** The interactive part of /msme-interest: everything is computed in the browser. */
export function MsmeInterestCalculator() {
  const [amount, setAmount] = useState('100000');
  const [accepted, setAccepted] = useState('2026-07-17');
  const [days, setDays] = useState('15');
  const [paid, setPaid] = useState(new Date().toISOString().slice(0, 10));
  const [basis, setBasis] = useState<RateBasis>('on_due_date');
  const out = useMemo(() => {
    const principal = Math.round(Number(amount) * 100);
    if (!(principal > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(accepted) || !/^\d{4}-\d{2}-\d{2}$/.test(paid)) return null;
    const due = msmedDueDates(accepted, Number(days) || null);
    return {due, r: msmedInterest({principal, interest_from: due.interest_from, paid_on: paid, rate_basis: basis})};
  }, [amount, accepted, days, paid, basis]);
  const inr = (minor: number) => formatMoney(minor / 100, 'INR');
  return (
    <form className="ledger-form" aria-label="MSMED interest calculator" onSubmit={e => e.preventDefault()}>
      <div className="two-col">
        <label>Amount due (₹)<input type="number" min={1} step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Day of acceptance (or deemed acceptance)<input type="date" value={accepted} onChange={e => setAccepted(e.target.value)} /></label>
        <label>Payment period agreed in writing (days, at most 45)<input type="number" min={1} max={45} value={days} onChange={e => setDays(e.target.value)} /></label>
        <label>Paid on (or today)<input type="date" value={paid} onChange={e => setPaid(e.target.value)} /></label>
      </div>
      <label>Bank Rate<select value={basis} onChange={e => setBasis(e.target.value as RateBasis)}><option value="on_due_date">The rate on the day payment fell due (default)</option><option value="per_period">Each period’s own rate</option></select></label>
      {out && <div role="status" aria-live="polite">
        <p><strong data-testid="msme-interest-total">Interest under MSMED s.16: {inr(out.r.interest)}</strong> ({MSMED_DISCLAIMER}) · payment was due by {out.due.pay_by}; interest from {out.due.interest_from}{out.r.covered ? '' : ' · the Bank Rate table does not reach back that far, so this is incomplete'}.</p>
        {out.r.periods.length > 0 && <table className="fine"><thead><tr><th>From</th><th>To</th><th>Days</th><th>Rate a year</th><th>Interest</th><th>Balance</th></tr></thead><tbody>{out.r.periods.map(p => <tr key={p.from}><td>{p.from}</td><td>{p.to}</td><td>{p.days}</td><td>{p.rates.map(g => `${g.rate_pa}% × ${g.days}d`).join(', ')}</td><td>{inr(p.interest)}</td><td>{inr(p.closing)}</td></tr>)}</tbody></table>}
      </div>}
    </form>
  );
}
