// Pure-logic tests for lib/*. No server required: `node tests/unit.mjs`.
import './support/ts-resolve.mjs';
import assert from 'node:assert/strict';
const {scopeSchema,itemsOf,sample}=await import('../lib/scope.ts');
const {semanticDiff,describeChange}=await import('../lib/diff.ts');
const {lintScope}=await import('../lib/lint.ts');
const {checkRequest,exclusionClauses}=await import('../lib/check.ts');
const {computeAgreement}=await import('../lib/ledger.ts');
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
console.log(JSON.stringify({passed,suite:'unit'}));
