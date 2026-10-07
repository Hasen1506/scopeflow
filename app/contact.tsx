import Link from 'next/link';
// BUG-8 / SF-17: no personal inbox is hard-coded in the UI. Set NEXT_PUBLIC_SUPPORT_EMAIL
// (a role address such as support@your-domain) at build time to show it on every page.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || '';
export function ContactLink() {
  return SUPPORT_EMAIL ? <a href={'mailto:' + SUPPORT_EMAIL}>{SUPPORT_EMAIL}</a> : <Link className="help-link" href="/support">the Support page</Link>;
}
