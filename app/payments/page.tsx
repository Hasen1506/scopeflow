import {Header} from '../ui';
import PaymentSettings from '../components/slots/payment-settings';

// WS-04: the owner's payment accounts and the inbox of client payment claims and alerts. WS-08
// mounts the same PaymentSettings in Account → Payments.
export const metadata = {title: 'Payments — Scopeflow', robots: {index: false, follow: false}};
export default function Page() {
  return <><Header/><main id="content" tabIndex={-1} className="shell"><section className="editor"><h1>Payments</h1><PaymentSettings/></section></main></>;
}
