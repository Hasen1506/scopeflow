// H1 (gap audit): bounded request-body reads. Every route reads its body through these instead of
// request.text() / formData(), so a large or chunked (no Content-Length) body is cut off at the
// route's limit instead of being buffered whole. Pure: no '@/' imports, unit tested under node.

/** Thrown when a body is over its limit; lib/errors.ts answers it with 413. */
export class BodyTooLarge extends Error {
  readonly limit: number;
  constructor(limit: number) { super('Input too large'); this.name = 'BodyTooLarge'; this.limit = limit; }
}

/** Request body limits in bytes, by kind of caller. */
export const BODY_LIMITS = {json: 24_000, oauth: 8_000, webhook: 256 * 1024, share: 1024 * 1024, esign: 8_000_000} as const;

/**
 * The body as bytes, at most `limit` of them. A declared Content-Length over the limit is refused
 * before anything is read; a body without one is read as a stream and cancelled at the limit.
 * A request without a body gives an empty array.
 */
export async function readBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > limit) throw new BodyTooLarge(limit);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); throw new BodyTooLarge(limit); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let i = 0;
  for (const chunk of chunks) { bytes.set(chunk, i); i += chunk.byteLength; }
  return bytes;
}

/** The body as UTF-8 text, at most `limit` bytes (see readBytes). */
export async function readText(request: Request, limit: number): Promise<string> {
  return new TextDecoder().decode(await readBytes(request, limit));
}

/** A form body (multipart or urlencoded) parsed only after it was read within `limit` bytes. */
export async function readFormData(request: Request, limit: number): Promise<FormData> {
  const bytes = await readBytes(request, limit);
  return new Response(bytes, {headers: {'content-type': request.headers.get('content-type') ?? ''}}).formData();
}
