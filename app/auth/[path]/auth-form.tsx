'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth/client';
import { safeReturnPath } from '@/lib/origin';
import { forgetDrafts } from '@/lib/editor';
import { rememberSession } from '@/lib/theme';
import { AuthProblem, AUTH_COPY, authProblem } from '@/lib/auth/problem';
import { zoneToAdopt } from '@/lib/time';

/** #17: an account with no saved time zone takes this browser's, so projects made through the API aren't UTC. Best effort. */
async function adoptBrowserZone() {
  try {
    const me = await fetch('/api/me', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null));
    if (!me?.signedIn || !me.defaults) return;
    const zone = zoneToAdopt(me.defaults.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (zone) await fetch('/api/workspace/account', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: zone }) });
  } catch { /* the account keeps no zone; it can be set on /account */ }
}



export default function AuthForm({ mode, returnTo, token, configured, explicitReturn = true }: {
  mode: string; returnTo: string; token?: string; configured: boolean;
  /** False when no return_to was given: a new account then goes to first-run onboarding (LT-04). */
  explicitReturn?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const { data: current } = authClient.useSession();
  const currentEmail = current?.user?.email ?? '';
  const title = mode === 'sign-up' ? 'Create your account' : mode === 'forgot-password' ? 'Reset your password' : mode === 'reset-password' ? 'Choose a new password' : 'Welcome back';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The form is noValidate so problems show inline, in the app's own words, next to each field.
    const el = event.currentTarget;
    for (const field of Array.from(el.elements) as HTMLInputElement[]) if (field.name) { if (field.validity.valid) field.removeAttribute('aria-invalid'); else field.setAttribute('aria-invalid', 'true'); }
    if (!el.checkValidity()) { setAttempted(true); setError(''); (el.querySelector(':invalid') as HTMLElement | null)?.focus(); return; }
    setBusy(true); setError(''); setMessage('');
    const form = new FormData(el);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    // SF-03: re-check the destination on the client too; never navigate off-site.
    const destination = safeReturnPath(returnTo);
    const callbackURL = window.location.origin + destination;
    try {
      if (mode === 'forgot-password') {
        const result = await authClient.requestPasswordReset({ email, redirectTo: window.location.origin + '/auth/reset-password' });
        if (result.error) throw new Error(result.error.message || 'Please try again.');
        setMessage('If an account exists for this email, you will receive a password reset link.');
      } else if (mode === 'reset-password') {
        if (!token) throw new Error('Open the password reset link from your email.');
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw new Error(result.error.message || 'This reset link is invalid or expired.');
        setMessage('Password updated. You can now sign in.');
      } else {
        // Switching accounts: end the current session (and forget its unsaved drafts in this browser)
        // before signing in, so nothing of the previous account carries over.
        if (currentEmail && (mode === 'sign-up' || currentEmail.toLowerCase() !== email.toLowerCase())) {
          await authClient.signOut();
          rememberSession(false);
          forgetDrafts();
        }
        // #3: the SDK may return {error} or throw a normalized error (401 invalid_credentials);
        // both go through authProblem so the copy and the password clearing are the same.
        let result: { error?: unknown };
        try {
          result = mode === 'sign-up'
            ? await authClient.signUp.email({ email, password, name: String(form.get('name') || '').trim(), callbackURL })
            : await authClient.signIn.email({ email, password, callbackURL });
        } catch (thrown) { throw authProblem(thrown, mode); }
        if (result.error) throw authProblem(result.error, mode);
        const session = await authClient.getSession();
        // LT-04/SF-11: a new account without a specific destination starts with onboarding.
        const next = mode === 'sign-up' && !explicitReturn ? '/onboarding' : destination;
        if (session.data?.user) { rememberSession(true); await adoptBrowserZone(); router.push(next); router.refresh(); }
        else setMessage('Check your email to verify your account, then sign in.');
      }
    } catch (error) {
      // Wrong details: clear the password so the next try starts clean. Service trouble: keep what was typed.
      if (error instanceof AuthProblem) { if (error.credentials && passwordRef.current) { passwordRef.current.value = ''; passwordRef.current.focus(); } setError(error.message); }
      else if (error instanceof TypeError) setError(AUTH_COPY.offline);
      else setError(error instanceof Error ? error.message : 'Please try again.');
    }
    finally { setBusy(false); }
  }
  const busyLabel = mode === 'sign-up' ? 'Creating account…' : mode === 'forgot-password' ? 'Sending link…' : mode === 'reset-password' ? 'Updating password…' : 'Signing in…';
  return <>
    <p className="eyebrow">YOUR SCOPEFLOW ACCOUNT</p><h1>{title}</h1>
    {configured && currentEmail && (mode === 'sign-in' || mode === 'sign-up') && <p className="muted-box auth-current" role="status">You are signed in as <b>{currentEmail}</b>. {mode === 'sign-in' ? 'Signing in with another email signs that account out first.' : 'Creating a new account signs that account out first.'} <Link className="help-link" href={safeReturnPath(returnTo)}>Stay signed in</Link></p>}
    {!configured ? <p className="error" role="alert">Sign-in is temporarily unavailable. Please contact support or try again later.</p> :
      <form onSubmit={submit} className="section-gap" noValidate data-attempted={attempted ? '' : undefined} aria-busy={busy}>
        {/* LT-11: each label names only its field (the hint sits outside the label); hints are tied by aria-describedby. */}
        {mode === 'sign-up' && <><label>Your name<input name="name" autoComplete="name" required minLength={2} maxLength={120} aria-describedby="name-hint" /></label><span id="name-hint" className="field-hint">Enter at least 2 characters.</span></>}
        {mode !== 'reset-password' && <><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} aria-describedby="email-hint" /></label><span id="email-hint" className="field-hint">Enter a full email address, like name@example.com.</span></>}
        {mode !== 'forgot-password' && <>
          <label className="password-label" htmlFor="auth-password">{mode === 'reset-password' ? 'New password' : 'Password'}</label>
          <div className="password-field">
            <input ref={passwordRef} id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} aria-describedby={mode === 'sign-in' ? 'password-error' : 'password-hint'} />
            <button type="button" className="password-toggle" aria-controls="auth-password" aria-pressed={showPassword} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Show'}</button>
          </div>
          {mode === 'sign-in' ? <span id="password-error" className="field-hint">Enter your password (at least 8 characters).</span> : <span id="password-hint" className="fine block">At least 8 characters. A longer passphrase is stronger.</span>}
        </>}
        {mode === 'sign-up' && <p className="fine auth-consent">By creating an account you agree to the <Link className="help-link" href="/terms">Terms of use</Link> and the <Link className="help-link" href="/privacy">Privacy notice</Link>.</p>}
        <button className="primary section-gap" disabled={busy || (mode === 'reset-password' && !token)}>{busy ? busyLabel : mode === 'sign-up' ? 'Create account' : mode === 'forgot-password' ? 'Send reset link' : mode === 'reset-password' ? 'Update password' : 'Sign in'}</button>
        <p className="sr-only" aria-live="polite">{busy ? busyLabel : ''}</p>
      </form>}
    {error && <div className="error" role="alert">{error}</div>}
    {message && <p className="muted-box" role="status">{message}</p>}
    {/* Only the ways out that make sense from this form (the sign-in page no longer links to itself). */}
    <p className="fine section-gap auth-switch">
      {mode === 'sign-in' && <>New to Scopeflow? <Link className="help-link" href={'/auth/sign-up?return_to=' + encodeURIComponent(returnTo)}>Create an account</Link> · <Link className="help-link" href="/auth/forgot-password">Forgot password?</Link></>}
      {mode === 'sign-up' && <>Already have an account? <Link className="help-link" href={'/auth/sign-in?return_to=' + encodeURIComponent(returnTo)}>Sign in</Link></>}
      {(mode === 'forgot-password' || mode === 'reset-password') && <>Remembered it? <Link className="help-link" href={'/auth/sign-in?return_to=' + encodeURIComponent(returnTo)}>Back to sign in</Link></>}
    </p>
  </>;
}
