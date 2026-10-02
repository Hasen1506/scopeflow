// Runs against disposable fictional data in the local preview only.
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','The suite cannot run against production.');
const dir='.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const files=readdirSync(dir).filter(f=>/^[0-9a-f]{64}\.sqlite$/.test(f));assert.equal(files.length,1);
for(const suite of ['unit','review-regressions','core','integration','ledger','account-deletion']){
 // Each suite tests throttles separately; isolate its fictional request counters.
 const db=new DatabaseSync(path.join(dir,files[0]));db.exec('PRAGMA busy_timeout=5000; DELETE FROM rate_limits');db.close();
 const result=spawnSync(process.execPath,['tests/'+suite+'.mjs'],{stdio:'inherit',env:{...process.env,SCOPEFLOW_TEST_URL:base}});
 if(result.status!==0)process.exit(result.status??1);
}
