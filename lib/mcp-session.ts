// In-memory Streamable HTTP sessions for /mcp. A session id lets a client open a
// GET stream and end it with DELETE. Calls without a session still work (the JSON
// clients this server already serves do not send one).

const TTL_MS = 60 * 60 * 1000;
const sessions = new Map<string, number>();

function live(id: string, now = Date.now()) {
  const at = sessions.get(id);
  if (at === undefined || now - at > TTL_MS) { sessions.delete(id); return false; }
  return true;
}

export function openSession(now = Date.now()) {
  const id = crypto.randomUUID();
  sessions.set(id, now);
  return id;
}
export function touchSession(id: string | null, now = Date.now()) {
  if (!id || !live(id, now)) return false;
  sessions.set(id, now);
  return true;
}
export function closeSession(id: string | null) {
  if (!id || !sessions.has(id)) return false;
  sessions.delete(id);
  return true;
}

/** SSE only when the client asks for event-stream and does not prefer JSON. */
export function wantsEventStream(accept: string | null): boolean {
  const parts = (accept ?? '').split(',').map(s => s.split(';')[0].trim().toLowerCase()).filter(Boolean);
  const jsonAt = parts.indexOf('application/json');
  const sseAt = parts.indexOf('text/event-stream');
  if (sseAt < 0) return false;
  if (jsonAt < 0) return true;
  return sseAt < jsonAt;
}
