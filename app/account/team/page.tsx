'use client';
import Link from 'next/link';
import {useEffect, useState, type FormEvent} from 'react';
import {Header, api, post} from '../../ui';

type Member = {id: string; email: string; role: string; status: string; created: string};
type Activity = {id: string; actor: string; kind: string; detail: Record<string, unknown>; created: string};
type Invite = {id: string; account: string; role: string; status: string};
type Team = {
  you: {id: string; email: string};
  account: {plan: string; name: string; seats: number; used: number; team: boolean};
  members: Member[];
  activity: Activity[];
  invites: Invite[];
  roles: Record<string, string>;
};

export default function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const me = await api('/api/me');
    setSignedIn(!!me.signedIn);
    if (me.signedIn) setTeam(await api('/api/team'));
  }
  useEffect(() => {
    let live = true;
    api('/api/me').then(async me => {
      if (!live) return;
      setSignedIn(!!me.signedIn);
      if (me.signedIn) setTeam(await api('/api/team'));
    }).catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);
  async function invite(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setError('');
    try { await api('/api/team', post({email, role})); setEmail(''); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError('');
    try { await api('/api/team?id=' + encodeURIComponent(id), {method: 'DELETE'}); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function accept(id: string) {
    setBusy(true); setError('');
    try { const r = await api('/api/team/accept', post({id})); await api('/api/team', {...post({account: r.account}), method: 'PUT'}); await load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <><Header /><main id="content" tabIndex={-1} className="shell">
    <div className="page-heading"><div><p className="eyebrow">ACCOUNT · TEAM</p><h1>Studio seats.</h1></div><p>Invite a manager, a member or finance. They work in your projects only after they accept and choose this studio. Billing stays on your own sign-in.</p></div>
    {signedIn === false && <p className="muted-box">Sign in to manage seats. <Link className="help-link" href="/auth/sign-in?return_to=%2Faccount%2Fteam">Sign in</Link></p>}
    {error && <p className="error" role="alert">{error}</p>}
    {team && <>
      <section className="muted-box" aria-labelledby="h-seats"><h2 id="h-seats" className="h-sub">{team.account.name}</h2><p>{team.account.used} of {team.account.seats} seats in use, including you ({team.you.email}). {team.account.team ? 'This plan includes team seats.' : 'Inviting people is on the Studio plan.'} <Link className="help-link" href="/plans">Plans</Link></p></section>
      <section className="editor section-gap" aria-labelledby="h-roles"><h2 id="h-roles">What each role can do</h2><ul className="bullets">{Object.entries(team.roles).map(([name, line]) => <li key={name}><strong>{name}</strong> — {line}</li>)}</ul></section>
      <section className="editor section-gap" aria-labelledby="h-people"><h2 id="h-people">People</h2>
        {team.members.length === 0 && <p className="fine">No one else is on this account yet.</p>}
        <ul className="bullets">{team.members.map(m => <li key={m.id}>{m.email} · {m.role} · {m.status} <button type="button" className="link-button" disabled={busy} onClick={() => void revoke(m.id)}>Remove</button></li>)}</ul>
        <form className="section-gap" onSubmit={e => void invite(e)}>
          <div className="two-col">
            <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></label>
            <label>Role<select value={role} onChange={e => setRole(e.target.value)}><option value="manager">Manager</option><option value="member">Member</option><option value="finance">Finance</option></select></label>
          </div>
          <button className="primary section-gap" disabled={busy || !team.account.team}>Invite</button>
        </form>
      </section>
      {team.invites.length > 0 && <section className="editor section-gap" aria-labelledby="h-invites"><h2 id="h-invites">Invites for you</h2><ul className="bullets">{team.invites.map(i => <li key={i.id}>{i.role} <button type="button" className="secondary" disabled={busy} onClick={() => void accept(i.id)}>Accept and work in this studio</button></li>)}</ul></section>}
      <section className="editor section-gap" aria-labelledby="h-activity"><h2 id="h-activity">Team activity</h2>
        {team.activity.length === 0 && <p className="fine">Invites, accepted seats, rate-card saves and prepared share links show up here.</p>}
        <ul className="bullets">{team.activity.map(a => <li key={a.id}>{a.created.slice(0, 16).replace('T', ' ')} · {a.kind}</li>)}</ul>
        <p className="fine section-gap">The shared rate card is the account rate card. A manager or finance member edits it from the studio workspace. You edit yours under the project’s rate card, or <Link className="help-link" href="/account">in settings</Link>.</p>
      </section>
    </>}
  </main></>;
}
