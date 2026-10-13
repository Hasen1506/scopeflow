import type {Metadata} from 'next';
import {Header} from '../ui';
import {MsmeInterestCalculator} from './calculator';
import {RBI_BANK_RATE} from '@/lib/msmed';

// WS-03 (SF-07): public MSMED Act s.16 interest calculator. No sign-in; nothing is stored.
export const metadata: Metadata = {
  title: 'MSME delayed payment interest calculator (MSMED Act s.16) · Scopeflow',
  description: 'Estimate compound interest with monthly rests at three times the RBI Bank Rate on late payments to micro and small enterprises under sections 15 and 16 of the MSMED Act, 2006. An estimate: confirm with your CA.',
  alternates: {canonical: '/msme-interest'},
};

export default function MsmeInterestPage() {
  return <><Header/><main id="content" tabIndex={-1} className="review-shell policy"><section className="editor">
    <p className="eyebrow">FREE TOOL · MSMED ACT 2006, SECTIONS 15 AND 16</p>
    <h1>MSME delayed payment interest calculator</h1>
    <p>A buyer must pay a micro or small enterprise by the date agreed in writing, never more than 45 days after the day of acceptance (or deemed acceptance) of the goods or services; with no written agreement, within 15 days. After that, the buyer owes compound interest with monthly rests at three times the Bank Rate notified by the Reserve Bank of India, whatever the contract says (s.16). Medium enterprises are not covered.</p>
    <MsmeInterestCalculator/>
    <h2>Bank Rate used</h2>
    <ul>{RBI_BANK_RATE.map(r => <li key={r.from}>{r.rate.toFixed(2)}% from {r.from} (×3 = {(r.rate * 3).toFixed(2)}% a year) · <a className="help-link" href={r.source} rel="noopener noreferrer">RBI press release</a></li>)}</ul>
    <p className="fine">Estimate — confirm with your CA. Which Bank Rate applies over a long delay (the rate on the day payment fell due, or each period’s own rate) is not settled by the Act; choose either above. Interest is daily at the annual rate ÷ 365 and added to the balance at each monthly rest. Registration matters: benefits may not apply to work agreed before your Udyam registration (Silpi Industries, 2021; Mahakali Foods, 2022; a larger-bench reference after NBCC, 2025, is pending). Sources: <a className="help-link" href="https://samadhaan.msme.gov.in/WriteReadData/DocumentFile/MSMED2006act.pdf" rel="noopener noreferrer">MSMED Act, 2006</a>.</p>
  </section></main></>;
}
