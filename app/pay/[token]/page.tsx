import {Header} from '../../ui';
import PayBlock from '../../components/slots/pay-block';

// WS-04: a page with only the PayBlock for a review link: what is open and how to pay the creator
// directly (UPI QR, bank details, their own checkout, "I've paid"). The review page mounts the same
// PayBlock (WS-07); this link is for sending "how to pay" on its own, e.g. by WhatsApp.
export const metadata = {title: 'Pay — Scopeflow', robots: {index: false, follow: false}, referrer: 'no-referrer'};
export default async function Page({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  return <><Header/><main id="main" className="review-shell"><p className="eyebrow">PAYMENT</p><PayBlock token={token}/><p className="fine section-gap"><a className="help-link" href={`/review/${token}`}>See the agreement and its record</a></p></main></>;
}
