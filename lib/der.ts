// Minimal ASN.1 DER encoding and parsing: enough for RFC 3161 timestamp requests and tokens and for
// the CMS SignedData inside a PAdES PDF signature. Works on Uint8Array; no dependencies.

export type Node = {tag: number; constructed: boolean; cls: number; start: number; header: number; length: number; end: number; bytes: Uint8Array; children?: Node[]};

function lengthBytes(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n = Math.floor(n / 256); }
  return [0x80 | out.length, ...out];
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}
/** One TLV with an explicit identifier octet (e.g. 0x30 SEQUENCE, 0xa0 [0] constructed). */
export function tlv(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  return concat(Uint8Array.of(tag, ...lengthBytes(body.length)), body);
}
export const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
/** SET OF, with members sorted by their encoding as DER requires. */
export const set = (...c: Uint8Array[]) => tlv(0x31, ...[...c].sort(compareBytes));
export const ctx = (n: number, ...c: Uint8Array[]) => tlv(0xa0 + n, ...c);
export const octets = (b: Uint8Array) => tlv(0x04, b);
export const nul = () => Uint8Array.of(0x05, 0x00);
export const bool = (v: boolean) => Uint8Array.of(0x01, 0x01, v ? 0xff : 0x00);
export function int(value: number | bigint | Uint8Array): Uint8Array {
  let bytes: number[];
  if (value instanceof Uint8Array) bytes = [...value];
  else {
    let n = BigInt(value);
    bytes = [];
    const ZERO = BigInt(0), BYTE = BigInt(255), EIGHT = BigInt(8);
    do { bytes.unshift(Number(n & BYTE)); n >>= EIGHT; } while (n > ZERO);
  }
  while (bytes.length > 1 && bytes[0] === 0 && bytes[1] < 0x80) bytes.shift();
  if (bytes[0] >= 0x80) bytes.unshift(0);
  return tlv(0x02, Uint8Array.from(bytes));
}
export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [];
    let n = p;
    do { chunk.unshift(n & 0x7f); n = Math.floor(n / 128); } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}
export function utcTime(d: Date): Uint8Array {
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(s));
}
export function compareBytes(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Parses one DER element at `offset` (recursing into constructed ones). Throws on malformed input. */
export function parse(buf: Uint8Array, offset = 0): Node {
  if (offset + 2 > buf.length) throw new Error('DER: truncated');
  const id = buf[offset];
  let tag = id & 0x1f, i = offset + 1;
  if (tag === 0x1f) { tag = 0; let b; do { b = buf[i++]; tag = tag * 128 + (b & 0x7f); } while (b & 0x80); }
  let length = buf[i++];
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length');
    length = 0;
    for (let k = 0; k < n; k++) length = length * 256 + buf[i++];
  }
  const header = i - offset, end = i + length;
  if (end > buf.length) throw new Error('DER: length beyond input');
  const node: Node = {tag, constructed: !!(id & 0x20), cls: id >> 6, start: offset, header, length, end, bytes: buf.subarray(offset, end)};
  if (node.constructed) {
    node.children = [];
    let p = i;
    while (p < end) { const c = parse(buf, p); node.children.push(c); p = c.end; }
  }
  return node;
}
export const content = (n: Node) => n.bytes.subarray(n.header);
export function oidString(n: Node): string {
  const b = content(n);
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.subarray(1)) { v = v * 128 + (x & 0x7f); if (!(x & 0x80)) { out.push(v); v = 0; } }
  return out.join('.');
}
/** Depth-first search for the first node matching `pred`. */
export function find(n: Node, pred: (n: Node) => boolean): Node | null {
  if (pred(n)) return n;
  for (const c of n.children ?? []) { const hit = find(c, pred); if (hit) return hit; }
  return null;
}
export const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], x => parseInt(x, 16));
