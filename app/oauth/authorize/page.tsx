import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {Header} from '@/app/ui';
import {getUser} from '@/lib/auth/server';
import {validateAuthorize, redirectWith, SCOPE_TEXT} from '@/lib/oauth';

export const dynamic = 'force-dynamic';
const FIELDS = ['client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'response_type', 'resource'] as const;

// OAuth consent screen for MCP clients such as ChatGPT (SF-01).
export default async function Authorize({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const raw = await searchParams;
  const query: Record<string, string | undefined> = {};
  for (const key of FIELDS) { const value = raw[key]; query[key] = typeof value === 'string' ? value : undefined; }
  const request = new Request('http://scopeflow.internal/oauth/authorize', {headers: await headers()});
  const checked = await validateAuthorize(request, query);
  if (!checked.ok && checked.redirect) redirect(redirectWith(request, checked.redirect_uri, {error: checked.error, error_description: checked.description, state: checked.state}));
  if (!checked.ok) {
    return <><Header/><main className="review-shell"><section className="editor"><p className="eyebrow">CONNECT AN APP</p><h1>This connection request is not valid.</h1><p className="error" role="alert">{(checked as {message: string}).message}</p></section></main></>;
  }
  const user = await getUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === 'string')).toString();
    redirect('/auth/sign-in?return_to=' + encodeURIComponent('/oauth/authorize?' + qs));
  }
  const {params} = checked;
  const destination = new URL(params.redirect_uri).host;
  return <><Header/><main className="review-shell"><section className="editor">
    <p className="eyebrow">CONNECT AN APP</p>
    <h1>Allow {params.client.name} to use your Scopeflow account?</h1>
    <p>Signed in as <strong>{user.email}</strong>. After you allow access you will return to <strong>{destination}</strong>.</p>
    <ul className="section-gap">{params.scope.map(s => <li key={s}>{SCOPE_TEXT[s] ?? s}</li>)}</ul>
    <p className="fine">The app can never approve a scope or change order on behalf of your client, and it never sees review links. You can disconnect it at any time from the Connect page.</p>
    <form method="post" action="/api/oauth/authorize" className="actions section-gap">
      {FIELDS.map(key => key === 'redirect_uri' ? <input key={key} type="hidden" name={key} value={params.redirect_uri}/> : key === 'scope' ? <input key={key} type="hidden" name={key} value={params.scope.join(' ')}/> : query[key] !== undefined ? <input key={key} type="hidden" name={key} value={query[key]}/> : null)}
      <button className="primary" name="decision" value="approve">Allow access</button>
      <button className="secondary" name="decision" value="deny">Cancel</button>
    </form>
  </section></main></>;
}
