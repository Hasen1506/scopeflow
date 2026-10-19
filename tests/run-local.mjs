// Only modifies the dedicated disposable localhost database and fictional accounts.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {requireLocalDatabase,localSql} from './support/local.mjs';
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','The suite cannot run against production.');
requireLocalDatabase();
// Phase 0: workstream suites (tests/ws-*.mjs) are discovered and run after the existing list, in alphabetical order.
const workstreamSuites=readdirSync('tests').filter(f=>/^ws-.+\.mjs$/.test(f)).sort().map(f=>f.slice(0,-'.mjs'.length));
for(const suite of ['unit','review-regressions','postgres','auth','core','integration','ledger','account-deletion','fixes','oauth','change-orders','radar','templates','payments','retention','money','receipt','otp','billing','trust','invoicing','operations','mcp-http','team','certificate','drafts',...workstreamSuites]){
 localSql('DELETE FROM rate_limits');
 // changed by WS-10 (M26): read limits live in the server's memory now; clear them too (test servers only).
 const operator=process.env.SCOPEFLOW_ADMIN_TOKEN||process.env.SCOPEFLOW_CRON_SECRET;
 if(operator)await fetch(base+'/api/readiness?scope=read-limits',{method:'DELETE',headers:{Authorization:'Bearer '+operator}}).catch(()=>{});
 const result=spawnSync(process.execPath,['tests/'+suite+'.mjs'],{stdio:'inherit',env:{...process.env,SCOPEFLOW_TEST_URL:base}});
 if(result.status!==0)process.exit(result.status??1);
}
