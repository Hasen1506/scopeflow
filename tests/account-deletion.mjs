import {signIn,localSql,ack} from './support/local.mjs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','Deletion tests use disposable LOCAL data only.');
let passed=0;
const cookie=await signIn(base);
async function call(path,method='GET',data,authenticated=true,headers={}){
 const r=await fetch(base+path,{method,headers:{...(authenticated?{cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data!==undefined?JSON.stringify(data):undefined});
 const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value};
}
function status(r,n){assert.equal(r.status,n,JSON.stringify(r.value));passed++;}
function eq(actual,expected){assert.deepEqual(actual,expected);passed++;}
const sql=localSql;
const content={title:'Disposable deletion QA '+randomUUID(),client:'Fictional Client',deliverables:'One fictional deliverable',exclusions:'Real client work',fee:10,currency:'USD',revisions:1,due:'',notes:'Local fixture only.'};
const created=await call('/api/scopes','POST',content);status(created,201);
const project=created.value.scope.project_id,version=created.value.scope.id,token=created.value.scope.token;
status(await call('/api/review/'+token,'POST',await ack(base,token,{decision:'approved',signer:'Fictional Reviewer',comment:'Local QA',version:1}),false),200);
status(await call('/api/scopes/'+project+'/ledger','POST',{kind:'goodwill',baseline_version:1,payload:{title:'Fictional goodwill',value:5}}),201);
const key=await call('/api/key','POST');status(key,200);
const ownBearer={Authorization:'Bearer '+key.value.token};
const otherOwner='local_deletion_other_'+randomUUID(),otherProject=randomUUID(),otherVersion=randomUUID(),otherToken='sf_'+randomUUID(),otherReview=createHash('sha256').update(randomUUID()).digest('hex');
const otherHash=createHash('sha256').update(otherToken).digest('hex');
// Current window: stale windows are purged opportunistically by the rate limiter (SF-13).
const nowWindow=Math.floor(Date.now()/60000);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const ownOwner=sql(`SELECT owner FROM projects WHERE id=${quote(project)}`)[0].results[0].owner;
sql(`INSERT INTO projects (id,owner,latest,created) VALUES (${quote(otherProject)},${quote(otherOwner)},1,'2026-10-01'); INSERT INTO versions (id,project_id,version,token,content,status,created) VALUES (${quote(otherVersion)},${quote(otherProject)},1,${quote(otherReview)},${quote(JSON.stringify(content))},'pending','2026-10-01'); INSERT INTO ledger_entries (id,project_id,seq,kind,baseline_version,actor,payload,ref,prev_hash,hash,created) VALUES (${quote(randomUUID())},${quote(otherProject)},1,'goodwill',1,'owner','{}',NULL,'0','0','2026-10-01'); INSERT INTO api_keys (hash,owner,expires,created) VALUES (${quote(otherHash)},${quote(otherOwner)},'2099-01-01','2026-10-01'); INSERT INTO rate_limits (id,window_id,hits) VALUES (${quote('owner:'+otherOwner)},${nowWindow},1),(${quote('key:'+otherOwner)},${nowWindow},1),(${quote('review:'+otherVersion)},${nowWindow},1);`);
const otherBearer={Authorization:'Bearer '+otherToken},origin={Origin:base};
status(await call('/api/scopes/'+project+'/export','GET',undefined,false,otherBearer),404);
status(await call('/api/account','GET',undefined,false),401);
status(await call('/api/account','GET',undefined,false,ownBearer),401);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},false,origin),401);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},false,{...origin,...ownBearer}),401);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,{...origin,...ownBearer}),401);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,{Origin:'https://untrusted.example'}),403);
status(await call('/api/account','DELETE',{confirmation:'DELETE'}),403);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,{...origin,'Sec-Fetch-Site':'cross-site'}),403);
status(await call('/api/account','DELETE',{confirmation:'delete'},true,origin),400);
status(await call('/api/account','DELETE',{confirmation:'DELETE',owner:otherOwner},true,origin),400);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,{...origin,'Content-Type':'text/plain'}),415);
status(await call('/api/scopes/'+project),200);
// Inject a failure late in the transaction and prove earlier deletions roll back.
sql(`CREATE FUNCTION scopeflow.deletion_qa_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id=${quote(project)} THEN RAISE EXCEPTION 'fictional test failure'; END IF; RETURN OLD; END $$; CREATE TRIGGER deletion_qa_abort BEFORE DELETE ON projects FOR EACH ROW EXECUTE FUNCTION scopeflow.deletion_qa_abort();`);
try{status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,origin),503);status(await call('/api/review/'+token,'GET',undefined,false),200);status(await call('/api/scopes','GET',undefined,false,ownBearer),200);eq(sql(`SELECT COUNT(*) AS n FROM rate_limits WHERE id=${quote('review:'+version)}`)[0].results[0].n,1);eq(sql(`SELECT COUNT(*) AS n FROM ledger_entries WHERE project_id=${quote(project)}`)[0].results[0].n,1);}finally{sql('DROP TRIGGER deletion_qa_abort ON projects; DROP FUNCTION scopeflow.deletion_qa_abort();');}
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,origin),200);
eq((await call('/api/account')).value,{projects:0,versions:0,ledger_entries:0});
eq(sql(`SELECT COUNT(*) AS n FROM ledger_entries WHERE project_id=${quote(project)}`)[0].results[0].n,0);
eq((await call('/api/scopes')).value.scopes,[]);
status(await call('/api/scopes/'+project),404);
status(await call('/api/review/'+token,'GET',undefined,false),404);
status(await call('/api/review/'+token,'POST',await ack(base,token,{decision:'approved',signer:'Fictional Reviewer',comment:'',version:1}),false),404);
status(await call('/api/scopes','GET',undefined,false,ownBearer),401);
eq(sql(`SELECT COUNT(*) AS n FROM rate_limits WHERE id=${quote('review:'+version)}`)[0].results[0].n,0);
eq(sql(`SELECT COUNT(*) AS n FROM rate_limits WHERE id IN (${quote('owner:'+ownOwner)},${quote('key:'+ownOwner)})`)[0].results[0].n,0);
eq(sql(`SELECT COUNT(*) AS n FROM api_keys WHERE owner=${quote(ownOwner)}`)[0].results[0].n,0);
status(await call('/api/scopes/'+otherProject,'GET',undefined,false,otherBearer),200);
status(await call('/api/review/'+otherReview,'GET',undefined,false),200);
eq(sql(`SELECT COUNT(*) AS n FROM ledger_entries WHERE project_id=${quote(otherProject)}`)[0].results[0].n,1);
eq(sql(`SELECT COUNT(*) AS n FROM rate_limits WHERE id IN (${quote('owner:'+otherOwner)},${quote('key:'+otherOwner)},${quote('review:'+otherVersion)})`)[0].results[0].n,3);
status(await call('/api/account','DELETE',{confirmation:'DELETE'},true,origin),200);
status(await call('/api/scopes','POST',content),201);
console.log(JSON.stringify({passed,selfServiceDeletion:true,confirmationAndBrowserAuth:true,transactionRollback:true,otherAccountPreserved:true,linksAndTokenInvalidated:true,ledgerDeleted:true,freshStart:true}));
