'use client';
import {useRouter} from 'next/navigation';
import {useState, type FormEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import {parseReceiptInput} from '@/lib/evidence';

/**
 * QA-02 (WS-02): the footer receipt check. It accepts a receipt's verify link, its JSON or its
 * fingerprint, and says inline "That doesn't look like a ScopeFlow receipt" for anything else,
 * without navigating. WS-09 replaces ReceiptCheck in app/site-footer.tsx with this component.
 */
export function ReceiptCheckForm({id = 'receipt-check'}: {id?: string}) {
  const router = useRouter();
  const [value, setValue] = useState(''), [error, setError] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const r = parseReceiptInput(value);
    if (r.kind === 'invalid') { setError(r.error); return; }
    setError('');
    router.push(r.kind === 'fingerprint' ? '/verify?' + new URLSearchParams({a: r.a}).toString() : '/verify?' + new URLSearchParams({p: r.p, v: String(r.v), a: r.a}).toString());
  }
  return (
    <form className="receipt-form" onSubmit={submit} role="search" aria-label="Verify a receipt" noValidate>
      <label className="sr-only" htmlFor={id}>Receipt link, JSON or fingerprint from a PDF receipt</label>
      <input id={id} value={value} onChange={e => { setValue(e.target.value); setError(''); }} placeholder="Paste a receipt link" autoComplete="off" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={error ? id + '-error' : undefined} />
      <button type="submit" aria-label="Open the receipt check"><ArrowRight size={18} /></button>
      {error && <p className="error" role="alert" id={id + '-error'}>{error}</p>}
    </form>
  );
}
