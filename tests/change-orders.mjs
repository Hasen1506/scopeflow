// Regression suite for the QA findings fixed in hark/fix-change-orders:
//  1. a change order recorded after approval reaches the client link as pending and the client can approve it;
//  2. per-project archive / delete, consistent with the SF-04 immutability triggers;
//  3. optional client email and "Send for signature" (copy-link / mailto fallback without a provider).
// Runs against the local preview with disposable fictional data only.
import {signIn, localSql, ack} from './support/local.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'This suite creates disposable LOCAL fixtures only.');
let passed = 0;
const cookie = await signIn(base, 'co-qa-' + randomUUID() + '@example.test');
const other = await signIn(base, 'co-qa-other-' + randomUUID() + '@example.test');
// Browser-like requests: session cookie plus the same-origin Origin header the workspace sends.
async function call(path, method = 'GET', data, {auth = cookie, headers = {}} = {}) {
  const r = await fetch(base + path, {method, headers: {...(auth ? {cookie: auth} : {}), Origin: base, ...(data !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: data !== undefined ? JSON.stringify(data) : undefined});
  const text = await r.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
  return {status: r.status, value};
}
function status(r, n) { assert.equal(r.status, n, JSON.stringify(r.value)); passed++; }
function eq(a, b) { assert.deepEqual(a, b); passed++; }
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

const scope = {title: 'CO regression ' + Date.now(), client: 'Fictional Client', deliverables: '', items: [{id: 'logo', title: 'Logo suite', price: 1000}], client_inputs: [], exclusions: 'Print', fee: 1000, currency: 'USD', revisions: 1, due: '2026-12-01', notes: ''};

// ---- 1. Change order after approval -------------------------------------------------
const created = await call('/api/scopes', 'POST', scope); status(created, 201);
const project = created.value.scope.project_id, token = created.value.scope.token;
const L = '/api/scopes/' + project + '/ledger';
status(await call('/api/review/' + token, 'POST', await ack(base, token, {decision: 'approved', signer: 'Fictional Reviewer', comment: '', version: 1}), {auth: null}), 200);
const opened = await call(L); status(opened, 200); eq(opened.value.open, true); eq(opened.value.chain.count, 0);
// Exactly what the workspace form posts: optional "why"/"client's words" left empty.
const uiPayload = {title: 'Instagram templates', reason: '', request_quote: '', add_items: [], remove_item_ids: [], fee_delta: 400, days_delta: 0, revisions_delta: 0};
// A failed submit returns a readable error the form shows inline (not a silent no-op).
const invalid = await call(L, 'POST', {kind: 'change_order', baseline_version: 1, payload: {...uiPayload, fee_delta: 0}, request_id: randomUUID()});
status(invalid, 400); assert.match(invalid.value.error, /must change deliverables, fee, timeline or revision rounds/); passed++;
const co = await call(L, 'POST', {kind: 'change_order', baseline_version: 1, payload: uiPayload, request_id: randomUUID()});
status(co, 201); eq(co.value.seq, 1); eq(co.value.chain.count, 1); eq(co.value.agreement.pending, 1);
const withPrefill = await call(L, 'POST', {kind: 'change_order', baseline_version: 1, payload: {title: '6 Instagram templates', reason: 'Asks for something that is not one of the agreed deliverables.', request_quote: 'Could you also make 6 Instagram templates?', add_items: [{id: 'n-' + randomUUID().slice(0, 8), title: '6 Instagram templates', qty: 1, unit: '', price: null, acceptance: ''}], remove_item_ids: [], fee_delta: 0, days_delta: 0, revisions_delta: 0}, request_id: randomUUID()});
status(withPrefill, 201); eq(withPrefill.value.seq, 2);
// The client's review link shows it pending approval.
let review = await call('/api/review/' + token, 'GET', undefined, {auth: null}); status(review, 200);
eq(review.value.ledger.agreement.change_orders.map(c => [c.seq, c.title, c.status]), [[1, 'Instagram templates', 'proposed'], [2, '6 Instagram templates', 'proposed']]);
eq(review.value.ledger.agreement.pending, 2);
// The client approves CO-1 on the link.
const approved = await call('/api/review/' + token + '/change-order', 'POST', {seq: 1, decision: 'approved', signer: 'Fictional Client', comment: ''}, {auth: null});
status(approved, 200); eq(approved.value.status, 'approved'); assert.ok(approved.value.receipt.signature); passed++;
review = await call('/api/review/' + token, 'GET', undefined, {auth: null});
eq(review.value.ledger.agreement.change_orders[0].status, 'approved'); eq(review.value.ledger.agreement.fee, 1400); eq(review.value.ledger.agreement.pending, 1);
const ownerView = await call(L); eq(ownerView.value.agreement.fee, 1400); eq(ownerView.value.chain.intact, true); eq(ownerView.value.seal.state, 'valid');

// ---- 2. Archive and delete ---------------------------------------------------------
const P = '/api/scopes/' + project;
// Signed evidence: delete refused, archive allowed.
const refused = await call(P, 'DELETE', {confirmation: 'DELETE'}); status(refused, 409); eq(refused.value.code, 'has_client_evidence');
status(await call(P, 'PATCH', {archived: true}, {auth: other}), 404);
const archivedR = await call(P, 'PATCH', {archived: true}); status(archivedR, 200); assert.ok(archivedR.value.project.archived); passed++;
const listed = await call('/api/scopes'); assert.ok(listed.value.scopes.find(s => s.project_id === project).archived); passed++;
eq((await call(P)).value.project.archived, archivedR.value.project.archived);
status(await call(L, 'POST', {kind: 'goodwill', baseline_version: 1, payload: {title: 'Archived goodwill', value: 5}}), 409);
status(await call(P, 'POST', {content: scope, expected_version: 1}), 409);
status(await call('/api/review/' + token, 'GET', undefined, {auth: null}), 200); // the signed record stays verifiable
status(await call(P, 'PATCH', {archived: false}), 200);
eq((await call(P)).value.project.archived, null);
// Database backstop: the per-project bypass cannot remove decided versions or ledger entries.
const decidedVersion = localSql(`SELECT id FROM versions WHERE project_id=${quote(project)}`)[0].results[0].id;
assert.throws(() => localSql(`BEGIN; SELECT set_config('scopeflow.allow_delete','on',true); DELETE FROM versions WHERE id=${quote(decidedVersion)}; COMMIT;`), /immutable/); passed++;
assert.throws(() => localSql(`BEGIN; SELECT set_config('scopeflow.allow_delete','on',true); DELETE FROM ledger_entries WHERE project_id=${quote(project)}; COMMIT;`), /append-only/); passed++;
eq(Number(localSql(`SELECT COUNT(*) AS n FROM ledger_entries WHERE project_id=${quote(project)}`)[0].results[0].n), 3);

// A draft nobody has decided can be deleted by its owner only, with confirmation.
const draft = await call('/api/scopes', 'POST', {...scope, title: 'Draft to delete ' + Date.now()}); status(draft, 201);
const D = '/api/scopes/' + draft.value.scope.project_id, draftToken = draft.value.scope.token;
status(await call(D, 'POST', {content: {...scope, fee: 1200}, expected_version: 1}), 201); // two pending versions
status(await call(D, 'DELETE', {}), 400);
status(await call(D, 'DELETE', {confirmation: 'DELETE'}, {auth: other}), 404);
status(await call(D, 'DELETE', {confirmation: 'DELETE'}, {headers: {Authorization: 'Bearer sf_not_a_session'}}), 403);
status(await call(D, 'DELETE', {confirmation: 'DELETE'}, {headers: {Origin: 'https://untrusted.example'}}), 403);
const deleted = await call(D, 'DELETE', {confirmation: 'DELETE'}); status(deleted, 200); eq(deleted.value.deleted, true);
status(await call(D), 404);
status(await call('/api/review/' + draftToken, 'GET', undefined, {auth: null}), 404);
eq(Number(localSql(`SELECT COUNT(*) AS n FROM versions WHERE project_id=${quote(draft.value.scope.project_id)}`)[0].results[0].n), 0);

// ---- 3. Client email and Send for signature ------------------------------------------
const me = await call('/api/me'); eq(me.value.mail, false); // no provider configured in tests/CI
const fresh = await call('/api/scopes', 'POST', {...scope, title: 'Send QA ' + Date.now()}); status(fresh, 201);
const S = '/api/scopes/' + fresh.value.scope.project_id;
status(await call(S, 'PATCH', {client_email: 'not-an-email'}), 400);
const saved = await call(S, 'PATCH', {client_email: ' Client@Example.test '}); status(saved, 200); eq(saved.value.project.client_email, 'client@example.test');
eq((await call(S + '/send')).value, {configured: false, client_email: 'client@example.test'});
status(await call(S + '/send', 'POST', {version: 1}, {headers: {Authorization: 'Bearer sf_not_a_session'}}), 401);
status(await call(S + '/send', 'POST', {version: 1}, {auth: other}), 404);
const sent = await call(S + '/send', 'POST', {version: 1}); status(sent, 200);
eq(sent.value.sent, false); eq(sent.value.configured, false); eq(sent.value.to, 'client@example.test');
assert.ok(sent.value.review_url.endsWith('/review/' + fresh.value.scope.token)); passed++;
assert.ok(decodeURIComponent(sent.value.mailto).includes('/review/' + fresh.value.scope.token)); passed++;
assert.ok(sent.value.mailto.startsWith('mailto:client%40example.test?')); passed++;
const override = await call(S + '/send', 'POST', {version: 1, email: 'other.client@example.test'}); status(override, 200); eq(override.value.to, 'other.client@example.test');
eq((await call(S)).value.project.client_email, 'other.client@example.test');
status(await call(S + '/send', 'POST', {version: 1, email: 'nope'}), 400);
status(await call(S + '/send', 'POST', {version: 1}, {headers: {Origin: 'https://untrusted.example'}}), 403);
status(await call(P + '/send', 'POST', {version: 1}), 409); // already decided
// The email lives on the project, never inside the signed scope content.
assert.ok(!('client_email' in (await call('/api/review/' + fresh.value.scope.token, 'GET', undefined, {auth: null})).value.scope.content)); passed++;

console.log(JSON.stringify({passed, suite: 'change-orders', changeOrderAfterApproval: true, clientSeesPending: true, clientApproves: true, archive: true, draftDelete: true, signedDeleteRefused: true, sendForSignatureFallback: true}));
