import assert from 'node:assert/strict';
import test from 'node:test';
import {createHtmlDeferral, deferScripts} from '../../scripts/defer-static-scripts.mjs';

const loaderMark = 'script[data-src]';
const blockingChunk = /<script\s[^>]*?(?<!data-)src="\/_next\/static\/chunks\//;

function streamed(chunks) {
  const stream = createHtmlDeferral();
  return chunks.map(chunk => stream.write(chunk)).join('') + stream.end();
}

test('framework script tags wait until after first paint, and the webpack id is kept', () => {
  const html = '<html><body><h1>Hi</h1><script src="/_next/static/chunks/app/page.js" id="_R_"></script><script src="/_next/static/chunks/other.js"></script></body></html>';
  const out = deferScripts(html);
  assert.equal(blockingChunk.test(out), false);
  assert.match(out, /<script data-src="\/_next\/static\/chunks\/app\/page\.js" id="_R_"><\/script>/);
  assert.match(out, /<script data-src="\/_next\/static\/chunks\/other\.js"><\/script>/);
  assert.ok(out.includes(loaderMark));
  assert.ok(out.indexOf('<h1>Hi</h1>') < out.indexOf(loaderMark));
});

test('a tag split across chunks still paints the heading before the script is held', () => {
  const out = streamed([
    '<html><body><h1>Review</h1><scr',
    'ipt src="/_next/static/chunks/a.js" id="_R_"></script><script src="/_next/static/chunks/b.js"></scr',
    'ipt></script></bo',
    'dy></html>',
  ]);
  assert.equal(blockingChunk.test(out), false);
  assert.match(out, /data-src="\/_next\/static\/chunks\/a\.js" id="_R_"/);
  assert.match(out, /data-src="\/_next\/static\/chunks\/b\.js"/);
  assert.equal(out.includes(loaderMark), true);
  assert.equal((out.match(/script\[data-src\]/g) || []).length, 1);
});

test('inline flight data that mentions a chunk url is left in place', () => {
  const html = '<html><body><script>self.__next_f.push("src=\\"/_next/static/chunks/app/page.js\\"")</script></body></html>';
  assert.equal(deferScripts(html), html);
});

test('an already rewritten document is unchanged', () => {
  const once = deferScripts('<html><body><script src="/_next/static/chunks/a.js"></script></body></html>');
  assert.equal(deferScripts(once), once);
  assert.equal(streamed([once.slice(0, 40), once.slice(40)]), once);
});

test('the heading is emitted before a later framework script finishes arriving', () => {
  const stream = createHtmlDeferral();
  const first = stream.write('<html><body><h1>Good work</h1><script src="/_next/static/chunks/a.js"></script>');
  assert.match(first, /<h1>Good work<\/h1>/);
  assert.equal(blockingChunk.test(first), false);
  const rest = stream.write('</body></html>') + stream.end();
  assert.equal(rest.includes(loaderMark), true);
});
