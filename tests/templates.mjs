// PR D regression suite: templates library (built-in starters, save-as-template, edit, delete,
// owner isolation, account deletion) and AI drafting disabled with an explanation when no
// OPENAI_API_KEY / ANTHROPIC_API_KEY is configured (CI configures none).
import assert from 'node:assert/strict';
import {signIn, localSql} from './support/local.mjs';
const base = process.env.SCOPEFLOW_TEST_URL || 'http://localhost:5173';
assert.equal(new URL(base).hostname, 'localhost', 'Local fixtures only.');
assert.ok(!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY, 'This suite expects no AI provider key.');
let passed = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed++; };
const ok = (v, message) => { assert.ok(v, message); passed++; };
async function call(path, {method = 'GET', cookie, body, headers = {}} = {}) {
  const h = {Origin: base, ...headers};
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return {status: r.status, data};
}
const email = `templates-${Date.now()}@example.test`;
const cookie = await signIn(base, email), other = await signIn(base, `templates-other-${Date.now()}@example.test`);

// Built-in starters are public; signed-in owners also see their own.
const anon = await call('/api/templates');
eq(anon.status, 200); eq(anon.data.signed_in, false);
ok(anon.data.templates.length >= 8 && anon.data.templates.every(t => t.builtin), 'starters');
const starter = anon.data.templates.find(t => t.id === 'builtin:website');
ok(starter && starter.content.items.length >= 3, 'website starter');

// Save as template (client may be blank), edit, list, delete.
const content = {...starter.content, title: 'My website package', fee: 120000, currency: 'INR'};
const saved = await call('/api/templates', {method: 'POST', cookie, body: {name: 'Website · India', content}});
eq(saved.status, 201);
const tpl = saved.data.template;
ok(/^tpl_[a-f0-9]{16}$/.test(tpl.id), 'id'); eq(tpl.builtin, false); eq(tpl.content.fee, 120000); eq(tpl.content.client, '');
eq((await call('/api/templates', {cookie})).data.templates.filter(t => !t.builtin).map(t => t.id), [tpl.id]);
const renamed = await call('/api/templates/' + tpl.id, {method: 'PUT', cookie, body: {name: 'Website · India v2', content: {...content, revisions: 3}}});
eq(renamed.status, 200); eq(renamed.data.template.name, 'Website · India v2'); eq(renamed.data.template.content.revisions, 3);

// Validation and isolation.
eq((await call('/api/templates', {method: 'POST', cookie, body: {name: 'x', content}})).status, 400);
eq((await call('/api/templates', {method: 'POST', cookie, body: {name: 'Bad content', content: {title: 'No'}}})).status, 400);
eq((await call('/api/templates', {method: 'POST', body: {name: 'Anon', content}})).status, 401);
eq((await call('/api/templates/' + tpl.id, {method: 'PUT', cookie: other, body: {name: 'Hijack'}})).status, 404);
eq((await call('/api/templates/' + tpl.id, {method: 'DELETE', cookie: other})).status, 404);
eq((await call('/api/templates', {cookie: other})).data.templates.filter(t => !t.builtin), []);
const builtinEdit = await call('/api/templates/builtin:website', {method: 'PUT', cookie, body: {name: 'Mine now'}});
eq(builtinEdit.status, 409); eq(builtinEdit.data.code, 'builtin');
eq((await call('/api/templates/' + tpl.id, {method: 'PUT', cookie, body: {}})).status, 400);

// Delete, and account deletion removes saved templates.
eq((await call('/api/templates/' + tpl.id, {method: 'DELETE', cookie})).data, {deleted: true, id: tpl.id});
eq((await call('/api/templates/' + tpl.id, {method: 'DELETE', cookie})).status, 404);
eq((await call('/api/templates', {method: 'POST', cookie, body: {name: 'Keep until account goes', content}})).status, 201);
const before = localSql(`SELECT COUNT(*)::int AS n FROM scopeflow.templates`)[0].results[0].n;
eq((await call('/api/account', {method: 'DELETE', cookie, body: {confirmation: 'DELETE'}})).status, 200);
eq(localSql(`SELECT COUNT(*)::int AS n FROM scopeflow.templates`)[0].results[0].n, before - 1);

// AI drafting: disabled with an explanation, both in /api/me and on the endpoint.
const me = await call('/api/me', {cookie: other});
eq(me.data.ai, {enabled: false, provider: null, model: null, reason: 'No OPENAI_API_KEY or ANTHROPIC_API_KEY is set on this server.'});
const draft = await call('/api/draft', {method: 'POST', cookie: other, body: {brief: 'A five page website for a dental clinic, launch in six weeks.'}});
eq(draft.status, 503); eq(draft.data.code, 'ai_disabled');
ok(/OPENAI_API_KEY or ANTHROPIC_API_KEY/.test(draft.data.error), 'explains why');
eq((await call('/api/draft', {method: 'POST', body: {brief: 'A five page website for a dental clinic.'}})).status, 401);

// The privacy notice says when an AI provider is called.
const privacy = await (await fetch(base + '/privacy')).text();
ok(/OpenAI or Anthropic/.test(privacy) && !/does not currently call an AI model/.test(privacy), 'privacy notice updated');
console.log(`templates: ${passed} checks passed`);
