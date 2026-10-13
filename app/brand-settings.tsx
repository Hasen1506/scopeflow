'use client';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {api} from './ui';
import {contrastRatio, parseColor} from '@/lib/theme';

// Client review pages follow the visitor's scheme: the light and dark page backgrounds from app/globals.css.
const CLIENT_BACKGROUNDS = {light: '#F4EEE1', dark: '#11152A'} as const;
/** UX-C05/C40: which client-page schemes need a darker (light page) or lighter (dark page) shade for text. */
function shadeNote(color: string): string {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? parseColor(color) : null;
  if (!c) return '';
  const fails = (bg: string) => contrastRatio(c, parseColor(bg)!) < 4.5;
  const light = fails(CLIENT_BACKGROUNDS.light), dark = fails(CLIENT_BACKGROUNDS.dark);
  if (light && dark) return 'This colour is hard to read as text, so client pages show your business name in a darker shade on light pages and a lighter shade on dark pages.';
  if (light) return 'This colour is light for text, so on light client pages your business name uses a darker shade of it.';
  if (dark) return 'On dark client pages (visitors who use dark mode) your business name uses a lighter shade of this colour.';
  return '';
}

type Brand = {brand_color: string; reply_to: string; logo: string; logo_url: string | null};
const MAX_LOGO = 150 * 1024;

/** Branding for the client review page, PDFs and emails: accent colour, logo and reply-to address. */
export function BrandSettings() {
  const [brand, setBrand] = useState<Brand | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [logoChanged, setLogoChanged] = useState(false);
  useEffect(() => { api('/api/profile').then(r => setBrand(r.brand ?? {brand_color: '', reply_to: '', logo: '', logo_url: null}), () => {}); }, []);
  if (!brand) return null;
  function pick(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setError('Choose a PNG or JPEG image.'); return; }
    if (file.size > MAX_LOGO) { setError(`The logo is ${Math.ceil(file.size / 1024)} KB; use an image under 150 KB.`); return; }
    const reader = new FileReader();
    reader.onload = () => { setBrand(b => b && {...b, logo: String(reader.result)}); setLogoChanged(true); };
    reader.readAsDataURL(file);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!brand) return; setBusy(true); setError('');
    try {
      const r = await api('/api/profile/brand', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({brand_color: brand.brand_color, reply_to: brand.reply_to, ...(logoChanged ? {logo: brand.logo} : {})})});
      setBrand(r.brand); setLogoChanged(false); toast.success('Branding saved. Your review pages, PDFs and emails use it from now on.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <section aria-labelledby="h-brand">
      <h2 id="h-brand">Branding</h2>
      <p className="fine">Shown to your clients on the review page, on receipts, invoices and statements, and in the emails Scopeflow sends for you. Your business name comes from Business details above.</p>
      <form className="ledger-form" aria-label="Branding" onSubmit={save}>
        <div className="two-col">
          <label>Accent colour
            <span className="color-row"><input type="color" aria-label="Pick the accent colour" value={brand.brand_color || '#1f6feb'} onChange={e => setBrand({...brand, brand_color: e.target.value})} /><input maxLength={7} placeholder="#1f6feb" value={brand.brand_color} onChange={e => setBrand({...brand, brand_color: e.target.value.trim()})} /></span>{shadeNote(brand.brand_color) && <span className="fine block" role="status">{shadeNote(brand.brand_color)}</span>}
          </label>
          <label>Reply-to address <span className="quiet">· optional</span><input type="email" autoComplete="email" maxLength={254} placeholder="you@yourstudio.com" value={brand.reply_to} onChange={e => setBrand({...brand, reply_to: e.target.value})} /><span className="fine block">Client replies to Scopeflow emails go here. Emails are sent as “Your business via Scopeflow”.</span></label>
        </div>
        <label>Logo <span className="quiet">· PNG or JPEG, under 150 KB</span><input type="file" accept="image/png,image/jpeg" onChange={e => pick(e.target.files?.[0])} /></label>
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL preview of the file being uploaded */}
        {brand.logo && <div className="client-brand"><img src={brand.logo} alt="Your logo preview" height={40} /><button type="button" className="secondary" onClick={() => { setBrand({...brand, logo: ''}); setLogoChanged(true); }}>Remove logo</button></div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save branding'}</button></div>
      </form>
    </section>
  );
}
