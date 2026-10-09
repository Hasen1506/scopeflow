// Only modifies the dedicated disposable localhost database and fictional accounts.
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {requireLocalDatabase,localSql} from './support/local.mjs';
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','The suite cannot run against production.');
requireLocalDatabase();
for(const suite of ['unit','review-regressions','postgres','auth','core','integration','ledger','account-deletion','fixes','oauth','change-orders','radar','templates','payments','retention','money','receipt','otp','billing','trust','invoicing']){
 localSql('DELETE FROM rate_limits');
 const result=spawnSync(process.execPath,['tests/'+suite+'.mjs'],{stdio:'inherit',env:{...process.env,SCOPEFLOW_TEST_URL:base}});
 if(result.status!==0)process.exit(result.status??1);
}
