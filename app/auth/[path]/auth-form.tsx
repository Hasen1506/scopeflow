'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Globe, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { formatFirebaseAuthError, useAuth } from '@/src/lib/auth-context';
import { safeReturnPath } from '@/lib/origin';
import { rememberSession } from '@/lib/theme';

export default function AuthForm({
  mode,
  returnTo,
}: {
  mode: string;
  returnTo: string;
  token?: string;
  configured?: boolean;
  explicitReturn?: boolean;
}) {
  const router = useRouter();
  const { user, signInWithGoogle, signInWithEmail, signUpWithEmail, requestPasswordReset, signOutUser } =
    useAuth();

  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const currentEmail = user?.email ?? '';
  const destination = safeReturnPath(returnTo || '/events');
  const title =
    mode === 'sign-up'
      ? 'Create your account'
      : mode === 'forgot-password'
        ? 'Reset your password'
        : mode === 'reset-password'
          ? 'Choose a new password'
          : 'Welcome back';

  async function handleGoogle() {
    if (googleBusy || busy) return;
    setGoogleBusy(true);
    setError('');
    setMessage('');
    try {
      const signed = await signInWithGoogle();
      rememberSession(true);
      toast.success(`Signed in as ${signed.displayName}`);
      router.push(destination === '/' ? '/events' : destination);
      router.refresh();
    } catch (err) {
      setError(formatFirebaseAuthError(err));
    } finally {
      setGoogleBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const el = event.currentTarget;
    for (const field of Array.from(el.elements) as HTMLInputElement[]) {
      if (field.name) {
        if (field.validity.valid) field.removeAttribute('aria-invalid');
        else field.setAttribute('aria-invalid', 'true');
      }
    }
    if (!el.checkValidity()) {
      setAttempted(true);
      setError('');
      (el.querySelector(':invalid') as HTMLElement | null)?.focus();
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData(el);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const name = String(form.get('name') || '').trim();

    try {
      if (mode === 'forgot-password') {
        await requestPasswordReset(email);
        setMessage('If an account exists for this email, a password reset link has been sent.');
      } else if (mode === 'sign-up') {
        if (currentEmail && currentEmail.toLowerCase() !== email.toLowerCase()) {
          await signOutUser();
        }
        const signed = await signUpWithEmail(name, email, password);
        rememberSession(true);
        toast.success(`Welcome to ContractLock, ${signed.displayName}`);
        router.push(destination === '/' ? '/events' : destination);
        router.refresh();
      } else {
        if (currentEmail && currentEmail.toLowerCase() !== email.toLowerCase()) {
          await signOutUser();
        }
        const signed = await signInWithEmail(email, password);
        rememberSession(true);
        toast.success(`Signed in as ${signed.displayName}`);
        router.push(destination === '/' ? '/events' : destination);
        router.refresh();
      }
    } catch (err) {
      if (passwordRef.current) {
        passwordRef.current.value = '';
      }
      setError(formatFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  const busyLabel =
    mode === 'sign-up'
      ? 'Creating account…'
      : mode === 'forgot-password'
        ? 'Sending link…'
        : 'Signing in…';

  return (
    <>
      <p className="eyebrow">YOUR CONTRACTLOCK ACCOUNT</p>
      <h1>{title}</h1>

      {currentEmail && (mode === 'sign-in' || mode === 'sign-up') && (
        <p className="muted-box auth-current" role="status">
          You are signed in as <b>{currentEmail}</b>.{' '}
          <Link className="help-link" href="/events">
            Open Event Hub
          </Link>
        </p>
      )}

      {(mode === 'sign-in' || mode === 'sign-up') && (
        <div className="auth-oauth-block section-gap">
          <button
            type="button"
            className="primary auth-google-btn"
            disabled={googleBusy || busy}
            onClick={() => void handleGoogle()}
          >
            <Globe size={17} aria-hidden="true" />
            <span>{googleBusy ? 'Connecting Google…' : 'Continue with Google'}</span>
          </button>
          <div className="auth-divider" aria-hidden="true">
            <span>or continue with email</span>
          </div>
        </div>
      )}

      <form
        onSubmit={submit}
        className="section-gap"
        noValidate
        data-attempted={attempted ? '' : undefined}
        aria-busy={busy}
      >
        {mode === 'sign-up' && (
          <>
            <label>
              Your name
              <input
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
                aria-describedby="name-hint"
              />
            </label>
            <span id="name-hint" className="field-hint">
              Enter at least 2 characters.
            </span>
          </>
        )}

        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            aria-describedby="email-hint"
          />
        </label>
        <span id="email-hint" className="field-hint">
          Enter a full email address, like name@example.com.
        </span>

        {mode !== 'forgot-password' && (
          <>
            <label className="password-label" htmlFor="auth-password">
              Password
            </label>
            <div className="password-field">
              <input
                ref={passwordRef}
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                maxLength={128}
                aria-describedby={mode === 'sign-in' ? 'password-error' : 'password-hint'}
              />
              <button
                type="button"
                className="password-toggle"
                aria-controls="auth-password"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {mode === 'sign-in' ? (
              <span id="password-error" className="field-hint">
                Enter your password (at least 8 characters).
              </span>
            ) : (
              <span id="password-hint" className="fine block">
                At least 8 characters. A longer passphrase is stronger.
              </span>
            )}
          </>
        )}

        {mode === 'sign-up' && (
          <p className="fine auth-consent">
            By creating an account you agree to the{' '}
            <Link className="help-link" href="/terms">
              Terms of use
            </Link>{' '}
            and the{' '}
            <Link className="help-link" href="/privacy">
              Privacy notice
            </Link>
            .
          </p>
        )}

        <button className="secondary section-gap auth-email-submit" disabled={busy || googleBusy}>
          <Mail size={15} aria-hidden="true" />
          <span>
            {busy
              ? busyLabel
              : mode === 'sign-up'
                ? 'Create account with email'
                : mode === 'forgot-password'
                  ? 'Send reset link'
                  : 'Sign in with email'}
          </span>
        </button>
        <p className="sr-only" aria-live="polite">
          {busy ? busyLabel : ''}
        </p>
      </form>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="muted-box" role="status">
          {message}
        </p>
      )}

      <p className="fine section-gap auth-switch">
        {mode === 'sign-in' && (
          <>
            New to ContractLock?{' '}
            <Link className="help-link" href={'/auth/sign-up?return_to=' + encodeURIComponent(destination)}>
              Create an account
            </Link>{' '}
            ·{' '}
            <Link className="help-link" href="/auth/forgot-password">
              Forgot password?
            </Link>
          </>
        )}
        {mode === 'sign-up' && (
          <>
            Already have an account?{' '}
            <Link className="help-link" href={'/auth/sign-in?return_to=' + encodeURIComponent(destination)}>
              Sign in
            </Link>
          </>
        )}
        {(mode === 'forgot-password' || mode === 'reset-password') && (
          <>
            Remembered it?{' '}
            <Link className="help-link" href={'/auth/sign-in?return_to=' + encodeURIComponent(destination)}>
              Back to sign in
            </Link>
          </>
        )}
      </p>

      <div className="auth-explore-strip">
        <span className="auth-explore-label">Explore without an account</span>
        <nav className="auth-explore-links" aria-label="Explore without signing in">
          <Link className="help-link" href="/events">
            Event Hub
          </Link>
          <span aria-hidden="true">·</span>
          <Link className="help-link" href="/check">
            Scan a clause
          </Link>
          <span aria-hidden="true">·</span>
          <Link className="help-link" href="/templates">
            Quick-Fill packs
          </Link>
        </nav>
      </div>
    </>
  );
}
