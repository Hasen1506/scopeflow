import {signIn,localSql,ack} from './support/local.mjs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','This test creates disposable LOCAL fixtures only.');
let passed=0;
const cookie=await signIn(base);
const s={title:'Local MCP and link QA '+Date.now(),client:'Fictional QA Client',deliverables:'One test design\nOne test revision',exclusions:'All real-world work',fee:100,currency:'USD',revisions:1,due:'',notes:'Disposable local test fixture.'};
async function call(path,method='GET',data,authenticated=true,headers={}){const r=await fetch(base+path,{method,headers:{...(authenticated?{cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data!==undefined?JSON.stringify(data):undefined});const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return {status:r.status,value};}
function eq(value,expected){assert.deepEqual(value,expected);passed++;}
function status(r,n){assert.equal(r.status,n,JSON.stringify(r.value));passed++;}
const key=randomUUID();const first=await call('/api/scopes','POST',s,true,{'Idempotency-Key':key});status(first,201);
const second=await call('/api/scopes','POST',s,true,{'Idempotency-Key':key});status(second,200);eq(second.value.scope.project_id,first.value.scope.project_id);
status(await call('/api/scopes','POST',{...s,fee:150},true,{'Idempotency-Key':key}),409);
const v=first.value.scope;
status(await call('/api/scopes/'+v.project_id+'/review-link','POST',{version:1,action:'revoke'},false),401);
status(await call('/api/scopes/'+v.project_id+'/review-link','POST',{version:1,action:'revoke'}),200);
status(await call('/api/review/'+v.token,'GET',undefined,false),404);
status(await call('/api/review/'+v.token,'POST',await ack(base,v.token,{decision:'approved',signer:'Local Reviewer',comment:'',version:1}),false),404);
const replacement=await call('/api/scopes/'+v.project_id+'/review-link','POST',{version:1,action:'rotate'});status(replacement,200);
status(await call('/api/review/'+v.token,'GET',undefined,false),404);
status(await call('/api/review/'+replacement.value.review_path.split('/').at(-1),'GET',undefined,false),200);
const history=await call('/api/scopes/'+v.project_id);eq(history.value.versions[0].content,s);eq(history.value.versions[0].revoked,0);
const otherToken='sf_local_disposable_'+randomUUID();const hash=createHash('sha256').update(otherToken).digest('hex');
localSql(`INSERT INTO api_keys (hash,owner,expires,created) VALUES ('${hash}','local_disposable_other','2099-01-01T00:00:00.000Z','${new Date().toISOString()}')`);
const otherHeaders={Authorization:'Bearer '+otherToken};
const otherList=await call('/api/scopes','GET',undefined,false,otherHeaders);status(otherList,200);eq(otherList.value.scopes,[]);
status(await call('/api/scopes/'+v.project_id,'GET',undefined,false,otherHeaders),404);
status(await call('/api/scopes/'+v.project_id,'POST',{expected_version:1,content:s},false,otherHeaders),404);
status(await call('/api/scopes/'+v.project_id+'/review-link','POST',{version:1,action:'revoke'},false,otherHeaders),401);
status(await call('/api/scopes','POST',null),400);
status(await call('/api/scopes/'+v.project_id,'POST',null),400);
status(await call('/api/scopes','POST',{...s,due:'2026-02-30'}),400);
status(await call('/api/scopes','POST',{...s,notes:'x'.repeat(25000)}),400);
const rpc=(method,params={},authenticated=true,headers={})=>call('/mcp','POST',{jsonrpc:'2.0',id:1,method,params},authenticated,{'Accept':'application/json, text/event-stream',...headers});
const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Local QA',version:'1'}},false);status(init,200);eq(init.value.result.protocolVersion,'2025-11-25');
// Ten original tools, five money tools, plus draft_scope, list_projects, read_project and create_share_link.
const tools=await rpc('tools/list',{},false);status(tools,200);eq(tools.value.result.tools.length,19);assert.ok(tools.value.result.tools.every(t=>t.outputSchema&&t.annotations));passed++;
status(await rpc('tools/call',{name:'list_scopes',arguments:{}},false),401);
status(await rpc('tools/call',{name:'list_scopes',arguments:{}},false,{'oai-authenticated-user-id':'spoofed','oai-authenticated-user-email':'spoofed@example.com'}),401);
const otherTools=await rpc('tools/call',{name:'list_scopes',arguments:{}},false,otherHeaders);status(otherTools,200);eq(otherTools.value.result.structuredContent.scopes,[]);
const listed=await rpc('tools/call',{name:'list_scopes',arguments:{}});status(listed,200);assert.ok(listed.value.result.structuredContent.scopes.every(x=>!('token' in x)));passed++;
const templates=await rpc('tools/call',{name:'list_scope_templates',arguments:{}},false);eq(templates.value.result.structuredContent.templates.length,12); // changed by WS-09: SF-22 adds four vertical packs to the eight starters
const invalid=await rpc('tools/call',{name:'create_scope',arguments:{content:s,request_id:randomUUID(),user_confirmed:false}});eq(invalid.value.error.code,-32602);
const requestId=randomUUID();const created=await rpc('tools/call',{name:'create_scope',arguments:{content:s,request_id:requestId,user_confirmed:true}});status(created,200);
// SF-02/SF-07: no review link for agents; the workspace URL uses the public origin, never 0.0.0.0.
assert.equal(created.value.result.structuredContent.review_url,undefined);assert.ok(!JSON.stringify(created.value.result).includes('/review/'));assert.equal(new URL(created.value.result.structuredContent.workspace_url).origin,base);passed++;
// API tokens on /mcp (ChatGPT connector): reject a missing credential, then list and create a draft.
// review_path stays null, and the JSON never contains a client review link.
const minted=await call('/api/key','POST',{},true,{Origin:base});status(minted,200);
const apiHeaders={Authorization:'Bearer '+minted.value.token};
status(await rpc('tools/call',{name:'list_scopes',arguments:{}},false),401);
const apiListed=await rpc('tools/call',{name:'list_scopes',arguments:{}},false,apiHeaders);status(apiListed,200);
assert.ok(apiListed.value.result.structuredContent.scopes.every(x=>(x.review_path??null)===null&&!('token' in x)));passed++;
const apiCreated=await rpc('tools/call',{name:'create_scope',arguments:{content:{...s,title:s.title+' via API token'},request_id:randomUUID(),user_confirmed:true}},false,apiHeaders);
status(apiCreated,200);
const apiBody=apiCreated.value.result.structuredContent;
eq(apiBody.review_path??null,null);eq(apiBody.scope.review_path??null,null);
assert.equal(apiBody.review_url,undefined);assert.ok(typeof apiBody.review_link==='string'&&!apiBody.review_link.includes('/review/'));
assert.ok(!JSON.stringify(apiCreated.value.result).includes('/review/'));passed++;
const retry=await rpc('tools/call',{name:'create_scope',arguments:{content:s,request_id:requestId,user_confirmed:true}});eq(retry.value.result.structuredContent.replayed,true);
const project=created.value.result.structuredContent.scope.project_id;
const revised=await rpc('tools/call',{name:'revise_scope',arguments:{project_id:project,expected_version:1,content:{...s,fee:150},user_confirmed:true}});eq(revised.value.result.structuredContent.scope.version,2);
const stale=await rpc('tools/call',{name:'revise_scope',arguments:{project_id:project,expected_version:1,content:s,user_confirmed:true}});eq(stale.value.result.isError,true);eq(stale.value.result.structuredContent.status,409);
const unknown=await rpc('tools/call',{name:'approve_scope',arguments:{}});eq(unknown.value.error.code,-32602);
status(await rpc('ping',{},false,{Origin:'https://untrusted.example'}),403);
status(await rpc('ping',{},false,{'MCP-Protocol-Version':'2099-01-01'}),400);
status(await call('/mcp','GET',undefined,false),405);
const notification=await call('/mcp','POST',{jsonrpc:'2.0',method:'notifications/initialized'},false);status(notification,202);
console.log(JSON.stringify({passed,idempotentCreation:true,revokedLinksBlocked:true,rotatedLinks:true,apiTenantIsolation:true,mcpAuthAndDiscovery:true,mcpCreateAndRevise:true,clientApprovalToolAbsent:true}));
