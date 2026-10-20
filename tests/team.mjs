// Studio seats, role checks and the shared rate card. Local server only.
import assert from 'node:assert/strict';
import {signIn, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost');
let passed = 0;
const ok = (v, m) => { assert.ok(v, m); passed++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); passed++; };
const stamp = Date.now();
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const response = await fetch(base + path, {method, headers: {...(cookie ? {Cookie: cookie} : {}), ...(body !== undefined ? {'Content-Type': 'application/json', Origin: base} : {}), ...headers}, body: body !== undefined ? JSON.stringify(body) : undefined});
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const setCookie = response.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') || '';
  return {status: response.status, data, setCookie};
}
const rows = sql => localSql(sql)[0].results;
const owner = await signIn(base, `studio-owner-${stamp}@example.test`);
const member = await signIn(base, `studio-member-${stamp}@example.test`);
const finance = await signIn(base, `studio-finance-${stamp}@example.test`);
const freeUser = await signIn(base, `studio-free-${stamp}@example.test`);

const scope = title => ({title, client: 'Kaveri Foods', deliverables: 'One page', exclusions: 'Print', fee: 100, currency: 'INR', revisions: 1, due: '', notes: ''});
const created = await call('/api/scopes', {method: 'POST', cookie: owner, body: scope('Studio home ' + stamp)});
eq(created.status, 201, JSON.stringify(created.data));
const project = created.data.scope.project_id;
const account = rows(`SELECT owner FROM projects WHERE id='${project}'`)[0].owner;
const freeProject = await call('/api/scopes', {method: 'POST', cookie: freeUser, body: scope('Free marker ' + stamp)});
eq(freeProject.status, 201);
const freeOwner = rows(`SELECT owner FROM projects WHERE id='${freeProject.data.scope.project_id}'`)[0].owner;
const now = new Date().toISOString();
localSql(`INSERT INTO scopeflow.accounts_plans (owner,plan,status,updated) VALUES ('${freeOwner}','free','active','${now}') ON CONFLICT (owner) DO UPDATE SET plan='free', status='active', updated='${now}'`);
eq((await call('/api/team', {method: 'POST', cookie: freeUser, body: {email: `nobody-${stamp}@example.test`, role: 'member'}})).status, 402);
localSql(`INSERT INTO scopeflow.accounts_plans (owner,plan,status,updated) VALUES ('${account}','agency','active','${now}') ON CONFLICT (owner) DO UPDATE SET plan='agency', status='active', updated='${now}'`);

const invited = await call('/api/team', {method: 'POST', cookie: owner, body: {email: `studio-member-${stamp}@example.test`, role: 'member'}});
eq(invited.status, 201, JSON.stringify(invited.data));
const financeInvite = await call('/api/team', {method: 'POST', cookie: owner, body: {email: `studio-finance-${stamp}@example.test`, role: 'finance'}});
eq(financeInvite.status, 201);
const team = await call('/api/team', {cookie: owner});
eq(team.data.account.seats, 5);
eq(team.data.account.used, 3);
ok(team.data.activity.some(a => a.kind === 'invite'));

const accepted = await call('/api/team/accept', {method: 'POST', cookie: member, body: {id: invited.data.member.id}});
eq(accepted.status, 200);
eq((await call('/api/team/accept', {method: 'POST', cookie: finance, body: {id: financeInvite.data.member.id}})).status, 200);
const entered = await call('/api/team', {method: 'PUT', cookie: member, body: {account}});
ok(entered.setCookie.includes('sf_studio='), entered.setCookie);
const memberCookie = member + '; ' + entered.setCookie;
const financeEntered = await call('/api/team', {method: 'PUT', cookie: finance, body: {account}});
const financeCookie = finance + '; ' + financeEntered.setCookie;

const seen = await call('/api/scopes', {cookie: memberCookie});
ok(seen.data.scopes.some(s => s.project_id === project), 'member sees the studio project');
ok(seen.data.scopes.every(s => (s.token ?? null) === null && (s.review_path ?? null) === null));
eq((await call('/api/scopes/' + project + '/review-link', {method: 'POST', cookie: memberCookie, body: {version: 1, action: 'rotate'}})).status, 403);
eq((await call('/api/scopes', {method: 'POST', cookie: financeCookie, body: scope('Finance cannot create ' + stamp)})).status, 403);

const card = {items: [{id: 'design', title: 'Design hour', unit: 'hour', unit_price_minor: 150000, currency: 'INR', tax_pct: 18, tags: []}], multipliers: []};
const memberCard = await call('/api/team/rate-card?account=' + encodeURIComponent(account), {method: 'PUT', cookie: member, body: card});
eq(memberCard.status, 403);
const financeCard = await call('/api/team/rate-card?account=' + encodeURIComponent(account), {method: 'PUT', cookie: finance, body: card});
eq(financeCard.status, 200, JSON.stringify(financeCard.data));
const read = await call('/api/team/rate-card?account=' + encodeURIComponent(account), {cookie: member});
eq(read.data.rate_card.items[0].id, 'design');
ok((await call('/api/team', {cookie: owner})).data.activity.some(a => a.kind === 'rate_card'));

const managerEmail = `studio-manager-${stamp}@example.test`;
const manager = await signIn(base, managerEmail);
const managerInvite = await call('/api/team', {method: 'POST', cookie: owner, body: {email: managerEmail, role: 'manager'}});
eq(managerInvite.status, 201);
eq((await call('/api/team/accept', {method: 'POST', cookie: manager, body: {id: managerInvite.data.member.id}})).status, 200);
const managerEntered = await call('/api/team', {method: 'PUT', cookie: manager, body: {account}});
const managerCookie = manager + '; ' + managerEntered.setCookie;
const made = await call('/api/scopes', {method: 'POST', cookie: managerCookie, body: scope('Manager draft ' + stamp)});
eq(made.status, 201, JSON.stringify(made.data));
eq(rows(`SELECT owner FROM projects WHERE id='${made.data.scope.project_id}'`)[0].owner, account);
eq((await call('/api/team', {method: 'POST', cookie: owner, body: {email: `extra-${stamp}@example.test`, role: 'member'}})).status, 201);
eq((await call('/api/team', {method: 'POST', cookie: owner, body: {email: `overflow-${stamp}@example.test`, role: 'member'}})).status, 429);

console.log(JSON.stringify({passed, seats: true, roles: true, rateCard: true}));
