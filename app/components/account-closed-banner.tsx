'use client';
import {useEffect, useState} from 'react';
// H10: the banner a client sees on a record whose creator closed their ScopeFlow account.
// Owner: WS-08. Mount on the client page (WS-07): <AccountClosedBanner token={token}/>.
// Renders nothing for a live account or while loading.
export default function AccountClosedBanner({token}: {token: string}) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/account/notice/' + encodeURIComponent(token)).then(r => (r.ok ? r.json() : null)).then(n => { if (live && n?.closed) setMessage(n.closed.message); }).catch(() => {});
    return () => { live = false; };
  }, [token]);
  if (!message) return null;
  return <p className="muted-box" role="status" data-testid="account-closed-banner">{message} You can still read it and download your receipt and invoices; nothing new can be recorded.</p>;
}
