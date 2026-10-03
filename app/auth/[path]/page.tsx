import { notFound } from 'next/navigation';
import { Header } from '@/app/ui';
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
  return <><Header /><main className="review-shell"><section className="editor">
    <AuthForm mode={path} returnTo={safeReturnPath(query.return_to)} token={typeof query.token === 'string' ? query.token : undefined} configured={authConfigured()} />
  </section></main></>;
}
