import Link from 'next/link';
import {SUPPORT_EMAIL, SUPPORT_EMAIL_PENDING} from '@/config/site';
// BUG-8 / SF-17: no personal inbox is hard-coded in the UI. The address comes from config/site.ts.
export {SUPPORT_EMAIL, SUPPORT_EMAIL_PENDING};
export function ContactLink() {
  return SUPPORT_EMAIL ? <a href={'mailto:' + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a> : <><Link className="help-link" href="/contact">the Contact page</Link> ({SUPPORT_EMAIL_PENDING})</>;
}
