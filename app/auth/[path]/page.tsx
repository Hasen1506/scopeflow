import { notFound } from 'next/navigation';
import { Header, Vignette } from '@/app/ui';
import { authConfigured } from '@/lib/auth/server';
import { safeReturnPath } from '@/lib/origin';
import AuthForm from './auth-form';

export const dynamic = 'force-dynamic';
const paths = ['sign-in', 'sign-up', 'forgot-password', 'reset-password'];
export default async function AuthPage({ params, searchParams }: {
  params: Promise<{ path: string }>;
  searchParams: Promise<{ return_to?: string; token?: string; error?: string }>;
}) {
  const { path } = await params;
  if (!paths.includes(path)) notFound();
  const query = await searchParams;
  return <><Header /><main id="main" className="auth-layout"><section className="editor">
    <AuthForm mode={path} returnTo={safeReturnPath(query.return_to)} token={typeof query.token === 'string' ? query.token : undefined} configured={authConfigured()} explicitReturn={typeof query.return_to === 'string' && query.return_to !== ''} />
  </section><aside className="auth-aside" aria-hidden="true"><Vignette /><p className="tagline">Write the scope once. Let the record do the remembering.</p></aside></main></>;
}
