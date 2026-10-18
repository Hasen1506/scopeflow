import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Header, Vignette } from '@/app/ui';
import { authConfigured } from '@/lib/auth/server';
import { safeReturnPath } from '@/lib/origin';
import AuthForm from './auth-form';

export const dynamic = 'force-dynamic';
const paths = ['sign-in', 'sign-up', 'forgot-password', 'reset-password'];
const titles: Record<string, string> = { 'sign-in': 'Sign in', 'sign-up': 'Create an account', 'forgot-password': 'Reset your password', 'reset-password': 'Choose a new password' };
export async function generateMetadata({ params }: { params: Promise<{ path: string }> }): Promise<Metadata> {
  const { path } = await params;
  return { title: `${titles[path] ?? 'Page not found'} — Scopeflow` };
}
export default async function AuthPage({ params, searchParams }: {
  params: Promise<{ path: string }>;
  searchParams: Promise<{ return_to?: string; token?: string; error?: string; signed_out?: string }>;
}) {
  const { path } = await params;
  if (!paths.includes(path)) notFound();
  const query = await searchParams;
  return <><Header /><main id="content" tabIndex={-1} className="auth-layout"><section className="editor">
    <AuthForm mode={path} returnTo={safeReturnPath(query.return_to)} token={typeof query.token === 'string' ? query.token : undefined} configured={authConfigured()} explicitReturn={typeof query.return_to === 'string' && query.return_to !== ''} signedOut={query.signed_out === '1'} />
  </section><aside className="auth-aside" aria-hidden="true"><Vignette /><p className="tagline">Write the scope once. Let the record do the remembering.</p></aside></main></>;
}
