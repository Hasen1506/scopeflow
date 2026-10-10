// Pure-logic tests for lib/*. No server required: `node tests/unit.mjs`.
import './support/ts-resolve.mjs';
import assert from 'node:assert/strict';
const {scopeSchema,itemsOf,sample}=await import('../lib/scope.ts');
const {semanticDiff,describeChange}=await import('../lib/diff.ts');
const {lintScope}=await import('../lib/lint.ts');
const {checkRequest,exclusionClauses}=await import('../lib/check.ts');
const ledgerModule=await import('../lib/ledger.ts');const {computeAgreement}=ledgerModule;
const {computeInsights}=await import('../lib/insights.ts');
let passed=0;
function test(name,fn){fn();passed++;}
const legacy={title:'Legacy scope',client:'Client Co',deliverables:'Logo\nGuidelines',exclusions:'',fee:100,currency:'USD',revisions:1,due:'',notes:''};

test('legacy content is stored unchanged',()=>{assert.deepEqual(scopeSchema.parse(legacy),legacy);});
test('legacy content needs deliverables',()=>{assert.equal(scopeSchema.safeParse({...legacy,deliverables:''}).success,false);});
test('items rewrite deliverables and fill defaults',()=>{
 const s=scopeSchema.parse({...legacy,deliverables:'',items:[{id:'a',title:'Page designs',qty:5,unit:'pages'},{id:'b',title:'Launch'}]});
 assert.equal(s.deliverables,'Page designs (5 pages)\nLaunch');
 assert.deepEqual(s.items[1],{id:'b',title:'Launch',qty:1,unit:'',price:null,acceptance:''});
});
test('duplicate item ids are rejected',()=>{assert.equal(scopeSchema.safeParse({...legacy,items:[{id:'a',title:'One'},{id:'a',title:'Two'}]}).success,false);});
test('unknown keys are rejected',()=>{assert.equal(scopeSchema.safeParse({...legacy,extra:1}).success,false);});
test('parse is idempotent for canonical content',()=>{const once=scopeSchema.parse(sample);assert.deepEqual(scopeSchema.parse(once),once);});
test('itemsOf derives legacy items',()=>{assert.deepEqual(itemsOf(legacy).map(i=>[i.id,i.title]),[['line-1','Logo'],['line-2','Guidelines']]);});

test('diff: legacy lines match new items by title',()=>{
 const next=scopeSchema.parse({...legacy,items:[{id:'x1',title:'logo',qty:2},{id:'x2',title:'Social templates',price:400}],fee:500});
 const changes=semanticDiff(legacy,next);
 const kinds=changes.map(c=>c.kind).sort();
 assert.deepEqual(kinds,['field','item_added','item_changed','item_removed']);
 const changed=changes.find(c=>c.kind==='item_changed');assert.deepEqual(changed.fields,['title','qty']);
 assert.match(describeChange(changes.find(c=>c.kind==='item_added'),'USD'),/Added: Social templates · \$400/);
 assert.match(describeChange(changes.find(c=>c.kind==='field'),'USD'),/Fee: \$100\.00 → \$500\.00/);
});
test('diff: identical scopes have no changes',()=>{assert.deepEqual(semanticDiff(sample,sample),[]);});
test('diff: ids win over titles',()=>{
 const a=scopeSchema.parse({...legacy,items:[{id:'k',title:'Homepage'}]}),b=scopeSchema.parse({...legacy,items:[{id:'k',title:'Landing page'}]});
 const c=semanticDiff(a,b);assert.equal(c.length,1);assert.equal(c[0].kind,'item_changed');
});
test('diff: client inputs',()=>{
 const a={...sample,client_inputs:[{id:'c1',title:'Copy',due:''}]},b={...sample,client_inputs:[{id:'c1',title:'Copy',due:'2026-11-01'},{id:'c2',title:'Logins',due:''}]};
 assert.deepEqual(semanticDiff(a,b).map(c=>c.kind),['input_changed','input_added']);
});

const rules=s=>lintScope(scopeSchema.parse(s),'2026-10-01').issues.map(i=>i.rule);
test('lint: vague language and unlimited',()=>{
 const r=lintScope(scopeSchema.parse({...legacy,deliverables:'Logo etc.',notes:'Unlimited revisions and minor tweaks as needed'}),'2026-10-01');
 assert.equal(r.issues[0].severity,'error');assert.ok(r.issues.filter(i=>i.rule==='vague-language').length>=3);assert.ok(r.score<70);
});
test('lint: fee mismatch when every item is priced',()=>{assert.ok(rules({...legacy,items:[{id:'a',title:'Logo',price:50},{id:'b',title:'Guide',price:20}]}).includes('fee-mismatch'));});
test('lint: no fee mismatch when items sum to fee',()=>{assert.ok(!rules({...legacy,items:[{id:'a',title:'Logo',price:60},{id:'b',title:'Guide',price:40}]}).includes('fee-mismatch'));});
test('lint: website projects should exclude hosting',()=>{
 const r=lintScope(scopeSchema.parse({...legacy,title:'Website build',exclusions:'Print'}),'2026-10-01');
 const c=r.issues.find(i=>i.rule==='category-exclusions');assert.match(c.message,/hosting/);
 assert.ok(!lintScope(scopeSchema.parse({...legacy,deliverables:'Five page designs',title:'Website build',exclusions:'Hosting, domain, maintenance, copywriting, SEO'}),'2026-10-01').issues.some(i=>i.rule==='category-exclusions'));
});
test('lint: plural title with qty 1',()=>{assert.ok(rules({...legacy,items:[{id:'a',title:'Social posts'}]}).includes('missing-quantity'));assert.ok(!rules({...legacy,items:[{id:'a',title:'Social posts',qty:12}]}).includes('missing-quantity'));});
test('lint: dates',()=>{const r=rules({...legacy,due:'2026-09-01',client_inputs:[{id:'c',title:'Copy',due:'2026-09-05'}]});assert.ok(r.includes('past-due'));assert.ok(r.includes('client-input-after-due'));});
test('lint: a well-specified scope is clear',()=>{
 const r=lintScope(scopeSchema.parse({title:'Brand identity',client:'Acme',deliverables:'',items:[{id:'a',title:'Logo suite',acceptance:'SVG and PNG',price:1000},{id:'b',title:'Brand guidelines',qty:12,unit:'pages',acceptance:'PDF',price:800}],client_inputs:[{id:'c',title:'Questionnaire',due:'2026-10-10'}],exclusions:'Print production, website design, trademark searches',fee:1800,currency:'USD',revisions:2,due:'2026-11-01',notes:'One round is one consolidated feedback list. 50% deposit, balance on delivery.'}),'2026-10-01');
 assert.deepEqual(r.issues,[]);assert.equal(r.score,100);assert.equal(r.grade,'clear');
});
test('lint: open-ended exclusions are fine',()=>{assert.ok(!rules({...legacy,exclusions:'Ongoing maintenance, hosting etc.'}).includes('vague-language'));});

const brand=scopeSchema.parse({title:'Brand identity',client:'Acme',deliverables:'',items:[{id:'logo',title:'Logo suite',acceptance:'SVG'},{id:'guide',title:'Brand guidelines',qty:12,unit:'pages'},{id:'posts',title:'Launch social posts',qty:6,unit:'posts'}],exclusions:'Website design, print production, and paid ads.',fee:1800,currency:'USD',revisions:2,due:'',notes:''});
const ag=(used=0)=>({...computeAgreement(brand,1,[]),revisions_used:used});
const verdict=(m,used)=>checkRequest(m,brand,ag(used));
test('check: exclusion clauses',()=>{assert.deepEqual(exclusionClauses(brand.exclusions).map(c=>c.text),['Website design','print production','paid ads']);});
test('check: excluded work',()=>{const r=verdict('Could you also design the website homepage?');assert.equal(r.verdict,'out_of_scope');assert.equal(r.matched_exclusions[0].text,'Website design');assert.ok(r.change_order.request_quote);assert.equal(r.change_order.add_items.length,1);});
test('check: printing synonyms',()=>{assert.equal(verdict('Can you handle printing the business cards?').verdict,'out_of_scope');});
test('check: more than agreed quantity',()=>{const r=verdict('Hi! Love it. Could you also do 10 Instagram posts for the launch week?');assert.equal(r.verdict,'out_of_scope');assert.match(r.reasons[0],/6 posts/);assert.equal(r.change_order.title,'10 Instagram posts for the launch week');const i=r.change_order.add_items[0];assert.deepEqual([i.title,i.qty,i.unit],['Additional launch social posts',4,'posts']);});
test('check: title skips pleasantries',()=>{assert.equal(verdict('Thanks so much for the drafts. Can you make a pitch deck template as well?').change_order.title,'A pitch deck template as well');});
test('check: another of a deliverable',()=>{assert.equal(verdict('Could we get another logo option?').verdict,'out_of_scope');});
test('check: brand-new work',()=>{assert.equal(verdict('Can you also make a pitch deck template?').verdict,'out_of_scope');});
test('check: revision with rounds left',()=>{const r=verdict('Can you make the logo a bit darker?');assert.equal(r.verdict,'revision');assert.equal(r.change_order,null);assert.match(r.reply,/round 1 of 2/);});
test('check: revision with no rounds left',()=>{const r=verdict('Can you tweak the logo colours again?',2);assert.equal(r.verdict,'revision');assert.equal(r.change_order.revisions_delta,1);});
test('check: in scope',()=>{assert.equal(verdict('When will the brand guidelines be ready?').verdict,'in_scope');});
test('check: ambiguous',()=>{const r=verdict('What do you think about the meeting on Tuesday?');assert.equal(r.verdict,'ambiguous');assert.equal(r.confidence,'low');});

test('insights: aggregates agreements and flags patterns',()=>{
 const e=(seq,kind,payload)=>({seq,kind,baseline_version:1,actor:'owner',created:'2026-10-01',payload,payload_hash:'',prev_hash:'',hash:''});
 const one=computeAgreement(brand,1,[e(1,'change_order',{title:'Extra',add_items:[],remove_item_ids:[],fee_delta:300,days_delta:0,revisions_delta:0,reason:'',request_quote:''}),e(2,'settle',{ref_seq:1,outcome:'approved',signer:'D',comment:''}),e(3,'revision_round',{feedback_date:'2026-10-02',note:''}),e(4,'revision_round',{feedback_date:'2026-10-03',note:''}),e(5,'revision_round',{feedback_date:'2026-10-04',note:''}),e(6,'goodwill',{title:'Gift',value:50,hours:1,note:'',visible:false})]);
 const two=computeAgreement({...brand,currency:'EUR'},1,[e(1,'revision_round',{feedback_date:'2026-10-02',note:''}),e(2,'revision_round',{feedback_date:'2026-10-03',note:''}),e(3,'revision_round',{feedback_date:'2026-10-04',note:''})]);
 const r=computeInsights([{project_id:'a',title:'A',client:'Acme',agreement:one},{project_id:'b',title:'B',client:' acme ',agreement:two}]);
 assert.deepEqual(r.fee_now,{USD:2100,EUR:1800});assert.deepEqual(r.change_order_value,{USD:300});assert.equal(r.change_orders.approval_rate,1);
 assert.equal(r.revision_rounds.projects_over,2);assert.equal(r.clients.length,1);assert.equal(r.clients[0].projects,2);
 assert.ok(r.observations.some(o=>/use 3 revision rounds on average but you include 2/.test(o)));assert.ok(r.observations.some(o=>/Acme/.test(o)));
 assert.deepEqual(r.creep,{requests:1,caught:{USD:300},approved:{USD:300},declined:{},pending:{}});assert.ok(r.observations.some(o=>/Scope creep caught: \$300/.test(o)));
});
test('insights: creep counts declined and pending requests, never withdrawn ones or fee cuts',()=>{
 const e=(seq,kind,payload)=>({seq,kind,baseline_version:1,actor:'owner',created:'2026-10-01',payload,payload_hash:'',prev_hash:'',hash:''});
 const co=(seq,fee)=>e(seq,'change_order',{title:'CO '+seq,add_items:[],remove_item_ids:[],fee_delta:fee,days_delta:0,revisions_delta:0,reason:'',request_quote:''});
 const a=computeAgreement(brand,1,[co(1,200),e(2,'settle',{ref_seq:1,outcome:'declined',signer:'D',comment:'no'}),co(3,150),co(4,90),e(5,'settle',{ref_seq:4,outcome:'withdrawn',signer:'',comment:''}),co(6,-100)]);
 const r=computeInsights([{project_id:'a',title:'A',client:'Acme',agreement:a}]);
 assert.deepEqual(r.creep,{requests:2,caught:{USD:350},approved:{},declined:{USD:200},pending:{USD:150}});
});

// ---- Regression tests for the 2026-10-07 audit fixes ----
const origin=await import('../lib/origin.ts');
const editor=await import('../lib/editor.ts');
const req=(url,headers={})=>new Request(url,{headers});
test('SF-03: return paths that normalise to protocol-relative URLs are rejected',()=>{
 for(const bad of ['/.//evil.example','/a/..//evil.example','/./\\evil.example','//evil.example','/\\evil.example','https://evil.example','/%2F%2Fevil.example/..//x','/.//evil.example?x=1','/auth/sign-in','/api/auth/x'])assert.ok(!origin.safeReturnPath(bad).startsWith('//'),bad);
 assert.equal(origin.safeReturnPath('/.//evil.example'),'/');assert.equal(origin.safeReturnPath('/a/..//evil.example'),'/');
 assert.equal(origin.safeReturnPath('/account?tab=1#x'),'/account?tab=1#x');assert.equal(origin.safeReturnPath('/oauth/authorize?client_id=a&state=b'),'/oauth/authorize?client_id=a&state=b');
});
test('Origin blocker: forwarded public origin is used when APP_URL is unset (Render, bound to 0.0.0.0)',()=>{
 const saved=process.env.APP_URL;delete process.env.APP_URL;
 try{
  const r=req('http://0.0.0.0:10000/api/key',{host:'scopeflow-qnng.onrender.com','x-forwarded-proto':'https',origin:'https://scopeflow-qnng.onrender.com'});
  assert.equal(origin.requestOrigin(r),'https://scopeflow-qnng.onrender.com');assert.equal(origin.appOrigin(r),'https://scopeflow-qnng.onrender.com');assert.equal(origin.safeOrigin(r),true);
  assert.equal(origin.publicUrl(r,'/review/x'),'https://scopeflow-qnng.onrender.com/review/x');
  assert.equal(origin.safeOrigin(req('http://0.0.0.0:10000/api/key',{host:'scopeflow-qnng.onrender.com','x-forwarded-proto':'https',origin:'https://evil.example'})),false);
  assert.equal(origin.safeOrigin(req('http://0.0.0.0:10000/api/key',{host:'scopeflow-qnng.onrender.com',origin:'null'})),false);
  assert.equal(origin.requestOrigin(req('http://0.0.0.0:10000/',{host:'bad host/x','x-forwarded-proto':'javascript'})),'http://0.0.0.0:10000');
  assert.equal(origin.requestOrigin(req('http://0.0.0.0:10000/',{'x-forwarded-host':'a.example, b.example','x-forwarded-proto':'https, http',host:'c.example'})),'https://a.example');
 }finally{if(saved===undefined)delete process.env.APP_URL;else process.env.APP_URL=saved;}
});
test('Origin blocker: APP_URL is canonical; same-origin requests still pass if APP_URL is mis-set',()=>{
 const saved=process.env.APP_URL;process.env.APP_URL='https://scopeflow-qnng.onrender.com/';
 try{
  const r=req('http://0.0.0.0:10000/x',{host:'scopeflow-qnng.onrender.com','x-forwarded-proto':'https',origin:'https://scopeflow-qnng.onrender.com'});
  assert.equal(origin.appOrigin(r),'https://scopeflow-qnng.onrender.com');assert.equal(origin.safeOrigin(r),true);
  process.env.APP_URL='https://old-name.onrender.com';
  assert.equal(origin.safeOrigin(r),true);
  assert.equal(origin.safeOrigin(req('http://0.0.0.0:10000/x',{host:'scopeflow-qnng.onrender.com','x-forwarded-proto':'https',origin:'https://attacker.example'})),false);
  assert.equal(origin.safeOrigin(req('http://0.0.0.0:10000/x',{host:'scopeflow-qnng.onrender.com'})),true,'no Origin header (server-to-server) passes as before');
 }finally{if(saved===undefined)delete process.env.APP_URL;else process.env.APP_URL=saved;}
});
test('BUG-1/2/13/14: editor helpers',()=>{
 assert.equal(editor.clampNumber(-500,0,10000000),0);assert.equal(editor.clampNumber(-1,0,50),0);assert.ok(Number.isNaN(editor.clampNumber(NaN,0,5)));
 assert.equal(editor.numberProblems({fee:-500,revisions:2}).fee,'The fee cannot be negative.');assert.ok(editor.numberProblems({fee:5,revisions:-1}).revisions);assert.deepEqual(editor.numberProblems({fee:0,revisions:0}),{});
 assert.match(editor.saveBlockReason({busy:false,signedIn:false,editingSaved:false,changed:false}),/Sign in/);
 assert.match(editor.saveBlockReason({busy:false,signedIn:true,editingSaved:true,changed:false}),/No changes/);
 assert.equal(editor.saveBlockReason({busy:false,signedIn:true,editingSaved:false,changed:false}),null);
 const draft={...sample,title:'Unsaved work'};const raw=editor.serializeDraft(draft,1000);
 assert.deepEqual(editor.restoreDraft(raw,2000),draft);assert.equal(editor.restoreDraft(raw,1000+15*86400000),null);assert.equal(editor.restoreDraft('{bad',0),null);assert.equal(editor.restoreDraft(JSON.stringify({v:1,saved_at:0,draft:{title:1}}),0),null);
 assert.equal(editor.meaningfulDraft(sample,sample,{...sample,title:''}),false);assert.equal(editor.meaningfulDraft(draft,sample,{...sample,title:''}),true);
});
test('Drafts belong to one account: never restored for another account or after sign-out',()=>{
 const draft={...sample,title:'Account A pricing'};
 const a=editor.serializeDraft(draft,1000,'acct-a');
 assert.deepEqual(editor.restoreDraft(a,2000,'acct-a'),draft);
 assert.equal(editor.restoreDraft(a,2000,'acct-b'),null,'another account never gets it');
 assert.equal(editor.restoreDraft(a,2000,null),null,'nor a signed-out visitor');
 assert.equal(editor.restoreDraft(editor.serializeDraft(draft,1000,null),2000,'acct-a'),null);
 // Version 1 drafts carried no owner: they are never restored.
 assert.equal(editor.restoreDraft(JSON.stringify({v:1,saved_at:1000,draft}),2000,null),null);
 assert.notEqual(editor.draftKey('acct-a'),editor.draftKey('acct-b'));assert.notEqual(editor.draftKey(null),editor.draftKey('acct-a'));
 const store=new Map([[editor.draftKey('acct-a'),'a'],[editor.draftKey('acct-b'),'b'],[editor.draftKey(null),'anon'],[editor.LEGACY_DRAFT_KEY,'old'],['scopeflow:signed-in','1']]);
 const storage={get length(){return store.size;},key:i=>[...store.keys()][i]??null,removeItem:k=>{store.delete(k);}};
 editor.clearDrafts(storage,'acct-b');
 assert.deepEqual([...store.keys()].sort(),[editor.draftKey('acct-b'),editor.draftKey(null),'scopeflow:signed-in'].sort(),'other accounts dropped');
 editor.clearDrafts(storage);
 assert.deepEqual([...store.keys()],['scopeflow:signed-in'],'sign-out removes every draft');
});
test('Server drafts keep only the editor fields, in step with the scope schema',()=>{
 let inner=scopeSchema;while(inner._def.schema)inner=inner._def.schema; // unwrap superRefine/transform layers
 assert.deepEqual([...editor.DRAFT_FIELDS].sort(),Object.keys(typeof inner._def.shape==='function'?inner._def.shape():inner.shape).sort());
 const d=editor.draftForStorage({...sample,stray:'x',items:[{id:'a',title:'A'},{nope:1}]});
 assert.equal('stray' in d,false);assert.equal(d.items.length,1);assert.equal(d.items[0].qty,1);
 assert.equal(editor.draftForStorage({title:1}),null);assert.equal(editor.draftForStorage(null),null);
});
test('SF-12: no delivery shift without a baseline due date',()=>{
 const {checkEntry:check}=ledgerModule;const base={...sample,due:''};const a=computeAgreement(base,1,[{seq:1,kind:'change_order',baseline_version:1,actor:'owner',created:'2026-10-01',payload:{title:'Later',reason:'',request_quote:'',add_items:[],remove_item_ids:[],fee_delta:0,days_delta:5,revisions_delta:0},payload_hash:'',prev_hash:'',hash:''},{seq:2,kind:'settle',baseline_version:1,actor:'client',created:'2026-10-02',payload:{ref_seq:1,outcome:'approved',signer:'C',comment:''},payload_hash:'',prev_hash:'',hash:''}]);
 assert.equal(a.days_shift,0);assert.equal(a.due,'');
 assert.match(check('change_order',{title:'Later',reason:'',request_quote:'',add_items:[],remove_item_ids:[],fee_delta:0,days_delta:3,revisions_delta:0},base,computeAgreement(base,1,[]),'owner'),/no delivery date/);
 assert.equal(check('change_order',{title:'Later',reason:'',request_quote:'',add_items:[],remove_item_ids:[],fee_delta:0,days_delta:3,revisions_delta:0},{...sample,due:'2026-12-01'},computeAgreement({...sample,due:'2026-12-01'},1,[]),'owner'),null);
});

// Change-order form regression (QA: the toolbar "Change order" button closed the open form and discarded it silently).
const {nextForm,changeOrderProblems}=await import('../lib/ledger-form.ts');
test('toolbar button never closes or discards the open form',()=>{
 let asked=0;const no=()=>{asked++;return false;},yes=()=>{asked++;return true;};
 assert.deepEqual(nextForm('change_order','change_order',{dirty:true,confirmDiscard:no}),{form:'change_order',reset:false});
 assert.deepEqual(nextForm('change_order','change_order',{dirty:false,confirmDiscard:no}),{form:'change_order',reset:false});
 assert.equal(asked,0);
 assert.deepEqual(nextForm(null,'change_order',{dirty:false,confirmDiscard:no}),{form:'change_order',reset:true});
 assert.deepEqual(nextForm('change_order','goodwill',{dirty:true,confirmDiscard:no}),{form:'change_order',reset:false});
 assert.deepEqual(nextForm('change_order','goodwill',{dirty:true,confirmDiscard:yes}),{form:'goodwill',reset:true});
 assert.deepEqual(nextForm('change_order','change_order',{dirty:false,reseed:true,confirmDiscard:no}),{form:'change_order',reset:true});
});
test('change order problems are explained before sending',()=>{
 const ok={title:'Instagram templates',reason:'',request_quote:'',add_items:[],remove_item_ids:[],fee_delta:400,days_delta:0,revisions_delta:0};
 assert.deepEqual(changeOrderProblems(ok),[]);
 assert.match(changeOrderProblems({...ok,title:'x'}).join(' '),/Change order title/);
 assert.match(changeOrderProblems({...ok,fee_delta:0}).join(' '),/must change deliverables, fee/);
 assert.match(changeOrderProblems({...ok,add_items:[{id:'n1',title:'',qty:1,unit:'',price:null,acceptance:''}]}).join(' '),/Added deliverable 1: title/);
 // "Why this is a change" and the client's words are optional on the server too.
 assert.deepEqual(changeOrderProblems({title:'Extra round',revisions_delta:1}),[]);
});
const mail=await import('../lib/mail.ts');
test('email delivery is configured only with RESEND_API_KEY and SCOPEFLOW_MAIL_FROM',()=>{
 assert.equal(mail.mailConfigured({}),false);
 assert.equal(mail.mailConfigured({RESEND_API_KEY:'re_x'}),false);
 assert.equal(mail.mailConfigured({SCOPEFLOW_MAIL_FROM:'a@b.co'}),false);
 assert.deepEqual(mail.mailConfig({RESEND_API_KEY:' re_x ',SCOPEFLOW_MAIL_FROM:'Scopeflow <s@b.co>'}),{provider:'resend',apiKey:'re_x',from:'Scopeflow <s@b.co>',replyTo:null,apiUrl:null});
});
test('signature email escapes content and the mailto fallback carries the link',()=>{
 const m=mail.signatureEmail({title:'Logo <b>\r\nBcc: x@evil.test',client:'Ana & Co',version:2,reviewUrl:'https://app.example/review/'+'a'.repeat(64)});
 assert.ok(!/[\r\n]/.test(m.subject));assert.match(m.subject,/version 2/);
 assert.ok(m.html.includes('Logo &lt;b&gt;'));assert.ok(m.html.includes('Ana &amp; Co'));assert.ok(!m.html.includes('<b>'));
 assert.ok(m.text.includes('https://app.example/review/'));
 const link=mail.mailtoLink('client@example.test',m);
 assert.ok(link.startsWith('mailto:client%40example.test?subject='));assert.ok(decodeURIComponent(link).includes('/review/'+'a'.repeat(64)));
 assert.equal(mail.clientEmailSchema.safeParse('not-an-email').success,false);
 assert.equal(mail.clientEmailSchema.parse(' Client@Example.test '),'client@example.test');
 assert.equal(mail.clientEmailSchema.parse(''),'');
});

console.log(JSON.stringify({passed,suite:'unit'}));
