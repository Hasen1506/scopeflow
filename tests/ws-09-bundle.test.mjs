// WS-09 L8: the workspace stays split into modules and the workspace route's JavaScript stays inside a budget.
// Auto-discovered by tests/run-local.mjs (runs after `next build`, with the local server up). Localhost only.
// @covers L8
import assert from 'node:assert/strict';
import {readdirSync,statSync,existsSync} from 'node:fs';

const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','Local server only.');

// 1. Source: no single workspace module grows back into the 85 KB component (L8).
const MODULE_BUDGET=48*1024;
assert.ok(!existsSync('app/workspace.tsx'),'app/workspace.tsx was split into app/workspace/**');
const modules=readdirSync('app/workspace').filter(f=>/\.tsx?$/.test(f));
for(const name of ['shell','state','project-list','editor','approval','changes','money','settings'])assert.ok(modules.includes(name+'.tsx'),`app/workspace/${name}.tsx exists`);
for(const f of modules){const size=statSync('app/workspace/'+f).size;assert.ok(size<MODULE_BUDGET,`app/workspace/${f} is ${size} bytes (budget ${MODULE_BUDGET})`);}

// 2. Built route: the JavaScript the workspace page (/) loads, summed over its <script src> chunks.
// Budget agreed for WS-09 (raw bytes, uncompressed); override with WS09_ROUTE_JS_BUDGET to tighten.
const ROUTE_BUDGET=Number(process.env.WS09_ROUTE_JS_BUDGET||2_500_000);
const html=await (await fetch(base+'/')).text();
const srcs=[...new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)].map(m=>m[1]).filter(s=>s.startsWith('/_next/')))];
assert.ok(srcs.length>0,'the workspace page loads Next.js chunks');
let total=0;
for(const s of srcs){const r=await fetch(new URL(s,base));assert.equal(r.status,200,s);total+=(await r.arrayBuffer()).byteLength;}
console.log(`ws-09 bundle: workspace route loads ${srcs.length} chunks, ${total} bytes (budget ${ROUTE_BUDGET})`);
assert.ok(total<ROUTE_BUDGET,`workspace route JS ${total} bytes exceeds budget ${ROUTE_BUDGET}`);
console.log('ws-09 bundle: ok');
