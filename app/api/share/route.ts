import {z} from 'zod';
import {getUser} from '@/lib/auth/server';
import {db, json, body, safeOrigin, allowWrite, failure, readFormData, BodyTooLarge, BODY_LIMITS} from '@/lib/server';
import {publicUrl} from '@/lib/origin';
import {assignCapture, createCapture, loadCapture, ownerProjects, pickProject} from '@/lib/capture';
export const runtime = 'nodejs';

// PWA Web Share Target (SF-03, WS-06): public/manifest.webmanifest posts shared text, a URL and
// files here (multipart). Signed in: the text becomes a capture (matched to a project when the
// message names one, or when only one project is active) and the browser is sent to /share to pick
// the project, read the radar verdict with the cited clause and review the prefilled change order.
// Signed out: the browser is sent to /share with the text, which asks the owner to sign in first.
// Shared images are counted but not read (no OCR yet). Browser session only, never an API token.
// GET ?capture=… and PATCH {capture_id, project_id} serve the /share page; POST JSON {text, url}
// creates a capture after sign-in.
const MAX_TEXT = 4000;
async function session(request: Request) { return request.headers.has('authorization') ? null : getUser(); }
const see = (request: Request, path: string) => new Response(null, {status: 303, headers: {Location: publicUrl(request, path), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});

async function reviewLink(request: Request, owner: string, projectId: string | null) {
  if (!projectId) return null;
  const v = await db().prepare('SELECT v.token,p.client_phone FROM projects p JOIN versions v ON v.project_id=p.id AND v.version=p.latest WHERE p.id=? AND p.owner=?').bind(projectId, owner).first<{token: string; client_phone: string | null}>();
  return v ? {link: publicUrl(request, '/review/' + v.token), phone: v.client_phone} : null;
}

export async function POST(request: Request) {
  try {
    const type = request.headers.get('content-type') ?? '';
    let text = '', url = '', files = 0;
    let known: Awaited<ReturnType<typeof session>> | undefined;
    if (/multipart\/form-data|application\/x-www-form-urlencoded/i.test(type)) {
      // The share target posts from the installed app (same origin); a cross-site form is refused.
      if (request.headers.get('origin') && !safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
      // H1: the session is checked before the form is read, and the form is read within a limit
      // (images are only counted, never stored): 1 MB signed in, 64 KB signed out (text only).
      // Over the limit the owner is sent to /share, which asks for the text instead of the image.
      const signedIn = known = await session(request);
      let form: FormData | null;
      try { form = await readFormData(request, signedIn ? BODY_LIMITS.share : 64 * 1024); }
      catch (e) { if (e instanceof BodyTooLarge) return see(request, signedIn ? '/share?empty=1&files=1' : '/share?files=1'); form = null; }
      if (!form) return json({error: 'Share text or a link.'}, 400);
      const s = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : ''; };
      text = s('text') || s('title');
      url = s('url');
      files = form.getAll('files').filter(f => typeof f !== 'string').length;
    } else {
      if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
      let raw;
      try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
      const input = z.object({text: z.string().trim().max(MAX_TEXT), url: z.string().trim().max(2000).optional()}).strict().safeParse(raw);
      if (!input.success) return json({error: 'Share the client’s message (up to 4000 characters).'}, 400);
      text = input.data.text; url = input.data.url ?? '';
    }
    text = text.slice(0, MAX_TEXT);
    const combined = (text || url).trim();
    const user = known !== undefined ? known : await session(request);
    const isForm = !/json/i.test(type);
    if (!user) {
      if (!isForm) return json({error: 'Sign in to check a shared message.'}, 401);
      const q = new URLSearchParams({...(combined ? {text: combined.slice(0, 1500)} : {}), ...(files ? {files: String(files)} : {})});
      return see(request, '/share?' + q.toString());
    }
    if (!await allowWrite('share:' + user.userId, 20)) return json({error: 'Too many shares. Try again in a minute.'}, 429);
    if (combined.length < 3) return isForm ? see(request, '/share?empty=1' + (files ? `&files=${files}` : '')) : json({error: 'Share the client’s message.'}, 400);
    const projects = await ownerProjects(user.userId);
    const capture = await createCapture(user.userId, {source: 'share', text: combined, url: url || null, files, projectId: pickProject(combined, projects)});
    return isForm ? see(request, '/share?capture=' + capture.id) : json({capture_id: capture.id}, 201);
  } catch (e) { return failure(e); }
}

export async function GET(request: Request) {
  try {
    const user = await session(request);
    if (!user) return json({error: 'Sign in to check a shared message.'}, 401);
    const id = new URL(request.url).searchParams.get('capture') ?? '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({error: 'Capture not found.'}, 404);
    const capture = await loadCapture(user.userId, id);
    if (!capture) return json({error: 'Capture not found.'}, 404);
    const [projects, review] = await Promise.all([ownerProjects(user.userId), reviewLink(request, user.userId, capture.project_id)]);
    return json({capture, projects, review});
  } catch (e) { return failure(e); }
}

export async function PATCH(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const user = await session(request);
    if (!user) return json({error: 'Sign in to check a shared message.'}, 401);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const input = z.object({capture_id: z.string().uuid(), project_id: z.string().min(1).max(80)}).strict().safeParse(raw);
    if (!input.success) return json({error: 'Pick a project.'}, 400);
    const radar = await assignCapture(user.userId, input.data.capture_id, input.data.project_id);
    if (!radar) return json({error: 'Project or capture not found.'}, 404);
    const [capture, review] = await Promise.all([loadCapture(user.userId, input.data.capture_id), reviewLink(request, user.userId, input.data.project_id)]);
    return json({capture, review});
  } catch (e) { return failure(e); }
}
