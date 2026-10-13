import {signIn,ack} from './support/local.mjs';
// Ledger lifecycle against a running local preview: `node tests/ledger.mjs`.
// Creates disposable fictional fixtures in the local account only.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import './support/ts-resolve.mjs';
const {verifyChain,anchorHash}=await import('../lib/ledger.ts');
const base=process.env.SCOPEFLOW_TEST_URL||'http://localhost:5173';
assert.equal(new URL(base).hostname,'localhost','This test creates disposable LOCAL fixtures only.');
let passed=0;
// changed by WS-05: M8 bounds ledger dates by today (+1 day) and the approval date, so the fixture dates are relative to today.
const today=new Date().toISOString().slice(0,10),day=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const cookie=await signIn(base);
async function call(path,method='GET',data,authenticated=true,headers={}){const r=await fetch(base+path,{method,headers:{...(authenticated?{cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data!==undefined?JSON.stringify(data):undefined});const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return {status:r.status,value};}
function status(r,n){assert.equal(r.status,n,JSON.stringify(r.value));passed++;}
function eq(a,b){assert.deepEqual(a,b);passed++;}

const s={title:'Ledger QA '+Date.now(),client:'Fictional Client',deliverables:'',items:[{id:'logo',title:'Logo suite',price:1000},{id:'guide',title:'Brand guidelines',qty:12,unit:'pages',price:800}],client_inputs:[{id:'brief',title:'Questionnaire',due:day(-4)}],exclusions:'Print',fee:1800,currency:'USD',revisions:1,due:day(20),notes:'Fixture.'};
const created=await call('/api/scopes','POST',s);status(created,201);
const project=created.value.scope.project_id,token=created.value.scope.token;
const L='/api/scopes/'+project+'/ledger';
const co={title:'Social templates',reason:'Requested on call',request_quote:'Could you also do Instagram templates?',add_items:[{id:'social',title:'Instagram templates',qty:6,unit:'templates',price:400}],fee_delta:400,days_delta:5};

// Closed until the client approves.
const closed=await call(L);status(closed,200);eq(closed.value.open,false);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:co}),409);
status(await call(L,'GET',undefined,false),401);
status(await call('/api/review/'+token,'POST',await ack(base,token,{decision:'approved',signer:'Fictional Reviewer',comment:'',version:1}),false),200);

// Owner writes.
status(await call(L,'POST',{kind:'change_order',baseline_version:2,payload:co}),409);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:{title:'Nothing'}}),400);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:{...co,remove_item_ids:['nope']}}),400);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:{...co,add_items:[{id:'logo',title:'Clash'}]}}),400);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:co},true,{Origin:'https://untrusted.example'}),403);
const rid=randomUUID();
const first=await call(L,'POST',{kind:'change_order',baseline_version:1,payload:co,request_id:rid});status(first,201);eq(first.value.seq,1);
const replay=await call(L,'POST',{kind:'change_order',baseline_version:1,payload:co,request_id:rid});status(replay,200);eq(replay.value.replayed,true);
status(await call(L,'POST',{kind:'change_order',baseline_version:1,payload:{...co,fee_delta:1},request_id:rid}),409);
const second=await call(L,'POST',{kind:'change_order',baseline_version:1,payload:{title:'Drop guidelines',remove_item_ids:['guide'],fee_delta:-800}});status(second,201);
status(await call(L,'POST',{kind:'settle',baseline_version:1,payload:{ref_seq:1,outcome:'approved'}}),400);
status(await call(L,'POST',{kind:'revision_round',baseline_version:1,payload:{feedback_date:today,note:'Round one'}}),201);
status(await call(L,'POST',{kind:'revision_round',baseline_version:1,payload:{feedback_date:day(1)}}),201);
status(await call(L,'POST',{kind:'client_input',baseline_version:1,payload:{input_id:'brief',received:today}}),201);
status(await call(L,'POST',{kind:'client_input',baseline_version:1,payload:{input_id:'brief',received:day(1)}}),400);
status(await call(L,'POST',{kind:'client_input',baseline_version:1,payload:{input_id:'ghost',received:day(1)}}),400);
status(await call(L,'POST',{kind:'goodwill',baseline_version:1,payload:{title:'Extra logo concept',value:150,hours:2}}),201);
status(await call(L,'POST',{kind:'goodwill',baseline_version:1,payload:{title:'Private rush fix',value:50,visible:false}}),201);

// Client decisions through the existing review link.
const RC='/api/review/'+token+'/change-order';
status(await call(RC,'POST',{seq:1,decision:'approved',signer:'F',comment:''},false),400);
status(await call(RC,'POST',{seq:2,decision:'declined',signer:'Fictional Reviewer',comment:''},false),400);
status(await call(RC,'POST',{seq:1,decision:'approved',signer:'Fictional Reviewer',comment:'Go ahead'},false),200);
status(await call(RC,'POST',{seq:1,decision:'declined',signer:'Fictional Reviewer',comment:'Changed my mind'},false),409);
status(await call(RC,'POST',{seq:3,decision:'approved',signer:'Fictional Reviewer',comment:''},false),409);
status(await call(L,'POST',{kind:'settle',baseline_version:1,payload:{ref_seq:2,outcome:'withdrawn'}}),201);
status(await call(RC,'POST',{seq:2,decision:'approved',signer:'Fictional Reviewer',comment:''},false),409);

const owner=await call(L);status(owner,200);
const a=owner.value.agreement;
eq(a.fee,2200);eq(a.due,day(29));eq(a.days_shift,9);eq([a.revisions_allowed,a.revisions_used,a.rounds_over],[1,2,1]);
eq(a.items.map(i=>i.id),['logo','guide','social']);eq(a.change_orders.map(c=>c.status),['approved','withdrawn']);
eq(a.goodwill_value,200);eq(a.delays[0].days_late,4);eq(owner.value.chain.intact,true);

// Exercise all four new MCP tools through the actual transport and identity boundary.
const rpc=(name,args={},authenticated=true,headers={})=>call('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},authenticated,headers);
const lint=await rpc('lint_scope',{content:s},false);status(lint,200);assert.equal(typeof lint.value.result.structuredContent.score,'number');passed++;
status(await rpc('get_agreement',{project_id:project},false),401);
const apiKey=await call('/api/key','POST');status(apiKey,200);
status(await rpc('get_agreement',{project_id:project},false,{Authorization:'Bearer '+apiKey.value.token}),200);
const agreement=await rpc('get_agreement',{project_id:project});status(agreement,200);eq(agreement.value.result.structuredContent.fee,2200);
const checked=await rpc('check_request',{project_id:project,message:'Can you also print the business cards?'});status(checked,200);eq(checked.value.result.structuredContent.heuristic.verdict,'out_of_scope');
const radared=await rpc('run_radar',{project_id:project,message:'Can you also print the business cards?'});status(radared,200);eq(radared.value.result.structuredContent.result.verdict,'out_of_scope');eq(radared.value.result.structuredContent.basis,'agreement');eq(radared.value.result.structuredContent.result.citations.length>0,true);
const proposal={project_id:project,baseline_version:1,change_order:{title:'MCP extra round',revisions_delta:1},request_id:randomUUID(),user_confirmed:true};
eq((await rpc('propose_change_order',{...proposal,user_confirmed:false})).value.error.code,-32602);
const proposed=await rpc('propose_change_order',proposal);status(proposed,200);eq(proposed.value.result.structuredContent.seq,10);
eq((await rpc('propose_change_order',proposal)).value.result.structuredContent.replayed,true);

// Client view hides private goodwill but the chain still verifies in a "browser".
const review=await call('/api/review/'+token,'GET',undefined,false);status(review,200);
const ledger=review.value.ledger;assert.ok(ledger);
eq(ledger.agreement.goodwill_value,150);eq(ledger.entries.filter(e=>e.payload===null).length,1);
const sc=review.value.scope;const anchor=await anchorHash({project_id:sc.project_id,version:sc.version,content:sc.content,signer:sc.signer,decided:sc.decided});
eq(anchor,ledger.anchors[1]);
eq((await verifyChain(ledger.entries,{1:anchor})).intact,true);
eq(ledger.seal.state,'valid');assert.ok(ledger.entries.every(e=>typeof e.signature==='string'));passed++;
const tampered=structuredClone(ledger.entries);tampered[0].payload.fee_delta=1;eq((await verifyChain(tampered,{1:anchor})).intact,false);
const reanchored=await anchorHash({project_id:sc.project_id,version:sc.version,content:{...sc.content,fee:1},signer:sc.signer,decided:sc.decided});eq((await verifyChain(ledger.entries,{1:reanchored})).intact,false);

// A new version closes the ledger for the old baseline.
// SF-06: replacing an approved agreement that has ledger entries needs explicit confirmation.
const blocked=await call('/api/scopes/'+project,'POST',{expected_version:1,content:{...s,fee:2200}});status(blocked,409);eq(blocked.value.code,'agreement_has_ledger');
const revised=await call('/api/scopes/'+project,'POST',{expected_version:1,content:{...s,fee:2200},supersede_agreement:true});status(revised,201);
const after=await call(L);eq(after.value.open,false);eq(after.value.entries.length,10);
const exported=await call('/api/scopes/'+project+'/export');status(exported,200);
eq(exported.value.versions.length,2);eq(exported.value.ledger_entries.length,10);
eq(exported.value.ledger_entries.find(e=>e.kind==='goodwill'&&e.payload.visible===false).payload.title,'Private rush fix');
status(await call('/api/scopes/'+project+'/export','GET',undefined,false),401);
status(await call('/api/scopes/missing-local-fixture/export'),404);
status(await call(L,'POST',{kind:'goodwill',baseline_version:1,payload:{title:'Late',value:1}}),409);
status(await call(RC,'POST',{seq:1,decision:'approved',signer:'Fictional Reviewer',comment:''},false),409);
status(await call('/api/review/'+revised.value.scope.token,'POST',await ack(base,revised.value.scope.token,{decision:'approved',signer:'Fictional Reviewer',comment:'',version:2}),false),200);
status(await call(L,'POST',{kind:'change_order',baseline_version:2,payload:co,request_id:rid}),409);
console.log(JSON.stringify({passed,suite:'ledger',changeOrders:true,clientDecisions:true,hashChain:true,privacy:true,staleBaselineBlocked:true}));
