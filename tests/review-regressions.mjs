import './support/ts-resolve.mjs';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import assert from 'node:assert/strict';
import {applyMigrations} from '../scripts/dev-migrate.mjs';
const {sample}=await import('../lib/scope.ts');
const {GENESIS}=await import('../lib/ledger.ts');
let passed=0;const eq=(a,b)=>{assert.deepEqual(a,b);passed++;};
const db=new DatabaseSync(':memory:');
eq(applyMigrations(db,'drizzle').length,4);eq(applyMigrations(db,'drizzle'),[]);
db.prepare('INSERT INTO projects VALUES (?,?,1,?)').run('project','fictional-owner','2026-10-02');
db.prepare('INSERT INTO versions (id,project_id,version,token,content,status,signer,created,decided) VALUES (?,?,1,?,?,?, ?,?,?)').run('v','project','a'.repeat(64),JSON.stringify(sample),'approved','Fictional Reviewer','2026-10-02','2026-10-02');
// An upgraded local preview may have the old schema but no helper journal.
db.exec('DROP TABLE _local_migrations');eq(applyMigrations(db,'drizzle').length,4);eq(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,1);
mkdirSync('.sites-runtime',{recursive:true});const temporary=mkdtempSync('.sites-runtime/migration-qa-');
try{
 writeFileSync(temporary+'/9999_failure.sql','CREATE TABLE must_rollback(id TEXT); --> statement-breakpoint\nINVALID SQL;');
 assert.throws(()=>applyMigrations(db,temporary));passed++;
 eq(db.prepare("SELECT name FROM sqlite_master WHERE name='must_rollback'").get(),undefined);
 eq(db.prepare("SELECT name FROM _local_migrations WHERE name='9999_failure.sql'").get(),undefined);
}finally{rmSync(temporary,{recursive:true});}
// Exercise the production append SQL against SQLite, with the server DB boundary replaced.
function prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)??null;},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};},async all(){return {results:db.prepare(sql).all(...values)};}};}
globalThis.scopeflowTestDB={prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='./server'&&context.parentURL?.endsWith('/lib/ledger-server.ts'))return {url:'data:text/javascript,export function db(){return globalThis.scopeflowTestDB}',shortCircuit:true};return next(specifier,context);}});
try{
 const {appendEntry,loadLedger,LedgerConflict}=await import('../lib/ledger-server.ts');
 const stale=await loadLedger('project');
 const first=await appendEntry({baseline:stale.baseline,expectedHead:GENESIS,kind:'client_input',payload:{input_id:'c_brief',received:'2026-10-02',shift:false,note:''},actor:'owner'});
 await assert.rejects(()=>appendEntry({baseline:stale.baseline,expectedHead:stale.head,kind:'client_input',payload:{input_id:'c_brief',received:'2026-10-03',shift:false,note:''},actor:'owner'}),LedgerConflict);passed++;
 eq(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get().n,1);
 const current=await loadLedger('project');eq(current.head,first.hash);eq(current.agreement.delays.length,1);
 const second=await appendEntry({baseline:current.baseline,expectedHead:current.head,kind:'goodwill',payload:{title:'Fictional work',value:10,hours:0,visible:false,note:''},actor:'owner'});eq(second.seq,2);
 const client=await loadLedger('project',{forClient:true});eq(client.entries[1].payload,null);eq(client.agreement.goodwill_value,0);
}finally{hooks.deregister();delete globalThis.scopeflowTestDB;db.close();}
const {checkRequest}=await import('../lib/check.ts');const {computeAgreement}=await import('../lib/ledger.ts');
const agreement=computeAgreement(sample,1,[]);const reply=checkRequest('Please add a website too',sample,agreement).reply;
assert.doesNotMatch(reply,/I.ve sent/);passed++;
console.log(JSON.stringify({passed,suite:'review-regressions',migrationBootstrapAndRollback:true,staleLedgerWriteRejected:true,clientPrivacy:true,truthfulDraftReply:true}));
