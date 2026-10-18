// The prerendered pages ship their framework scripts as parser-blocking downloads.
// On a fast machine those files finish before first paint, so Lighthouse's simulated
// mobile LCP treats them as critical. Hold the tags until after the first paint: the
// heading is already in the HTML, and hydration starts on the next frame.
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = new URL('../.next/server/', import.meta.url);
const loader = '<script>requestAnimationFrame(function(){setTimeout(function(){document.querySelectorAll("script[data-src]").forEach(function(s){var n=document.createElement("script");n.src=s.getAttribute("data-src");n.async=!0;if(s.id)n.id=s.id;s.replaceWith(n)})},0)})</script>';
const OPEN = '<script';
const CLOSE = '</script>';
const BODY_END = '</body>';

/** One complete script tag. Leaves data-src tags and inline scripts alone. */
export function rewriteScriptTag(tag) {
  const match = /^<script\s+([^>]*?)src="(\/_next\/static\/chunks\/[^"]+)"([^>]*)>\s*<\/script>$/s.exec(tag);
  if (!match) return tag;
  const pre = match[1];
  // `data-src` contains the letters `src`; only a real src attribute (start or whitespace before it) counts.
  if (pre.length && !/\s$/.test(pre)) return tag;
  const id = /(?:^|\s)id="([^"]+)"/.exec(pre + match[3]);
  return `<script data-src="${match[2]}"${id ? ` id="${id[1]}"` : ''}></script>`;
}

function holdTail(buf, watchBody) {
  const needles = watchBody ? [OPEN, BODY_END] : [OPEN];
  let keep = 0;
  for (const needle of needles) {
    const max = Math.min(needle.length - 1, buf.length);
    for (let k = max; k >= 1; k--) {
      if (buf.endsWith(needle.slice(0, k))) {
        keep = Math.max(keep, k);
        break;
      }
    }
  }
  return keep;
}

/**
 * Streaming form of {@link deferScripts}. Emits HTML as soon as a tag is complete so the
 * heading can paint before the rest of a dynamic page arrives. Idempotent.
 */
export function createHtmlDeferral() {
  let buf = '';
  let rewrote = false;
  let loaderSeen = false;
  const take = (final) => {
    let out = '';
    let holdingTag = false;
    while (buf.length) {
      const start = buf.indexOf(OPEN);
      const bodyAt = buf.indexOf(BODY_END);
      if (rewrote && !loaderSeen && bodyAt !== -1 && (start === -1 || bodyAt < start)) {
        out += buf.slice(0, bodyAt) + loader;
        loaderSeen = true;
        buf = buf.slice(bodyAt);
        continue;
      }
      if (start === -1) break;
      const endRel = buf.slice(start).indexOf(CLOSE);
      if (endRel === -1) {
        // Keep the whole open tag. A short tail check would flush `src=` before `</script>` arrives.
        out += buf.slice(0, start);
        buf = buf.slice(start);
        holdingTag = true;
        break;
      }
      out += buf.slice(0, start);
      const tag = buf.slice(start, start + endRel + CLOSE.length);
      if (tag.includes('script[data-src]')) loaderSeen = true;
      const next = rewriteScriptTag(tag);
      if (next !== tag) rewrote = true;
      out += next;
      buf = buf.slice(start + tag.length);
    }
    if (final) {
      out += buf;
      buf = '';
      return out;
    }
    if (holdingTag) return out;
    const keep = holdTail(buf, rewrote && !loaderSeen);
    out += buf.slice(0, buf.length - keep);
    buf = buf.slice(buf.length - keep);
    return out;
  };
  return {
    write(chunk) {
      buf += chunk;
      return take(false);
    },
    end() {
      return take(true);
    },
  };
}

/** Hold framework scripts until after the first paint. Idempotent. */
export function deferScripts(html) {
  const stream = createHtmlDeferral();
  return stream.write(html) + stream.end();
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  let files = 0;
  for (const path of await walk(root.pathname)) {
    const text = await readFile(path, 'utf8');
    const next = deferScripts(text);
    if (next === text) continue;
    await writeFile(path, next);
    files++;
  }
  console.log(`defer-static-scripts: held framework scripts on ${files} prerendered pages`);
}
