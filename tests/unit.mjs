// Pure-logic tests for lib/*. No server required: `node tests/unit.mjs`.
import './support/ts-resolve.mjs';
import assert from 'node:assert/strict';
const {scopeSchema,itemsOf,sample}=await import('../lib/scope.ts');
const {semanticDiff,describeChange}=await import('../lib/diff.ts');
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
console.log(JSON.stringify({passed,suite:'unit'}));
