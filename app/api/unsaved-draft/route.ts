import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure, accountKey} from '@/lib/server';
import {draftForStorage} from '@/lib/editor';
import {unsavedDraftCutoff} from '@/lib/retention-sql';

// The account's unsaved scope draft (one per account). The workspace autosaves it here so it follows
// the owner to any device, survives signing out, and nothing of it stays in the browser afterwards.
// Browser sessions only: API tokens and OAuth clients have no use for it. Autosave has its own write
// budget so it never uses up the owner's limit for real changes. Writes name the account they were
// typed in (`account`, from /api/me): tabs share one sign-in, so a tab still showing account A after
// another tab signed in as B gets 409 instead of saving A's draft into B's account.
const AUTOSAVES_PER_MINUTE = 120;
async function sessionOwner(request: Request) {
  const auth = await ownerAuth(request);
  return auth?.via === 'session' ? auth.user : null;
}
type Row = {content: string; updated: string};

export async function GET(request: Request) {
  try {
    const owner = await sessionOwner(request);
    if (!owner) return json({error: 'Sign in to see your draft.'}, 401);
    if (!await allowRead('owner:' + owner)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT content,updated FROM drafts WHERE owner=? AND updated >= ?').bind(owner, unsavedDraftCutoff(new Date().toISOString())).first<Row>();
    return json(row ? {draft: draftForStorage(JSON.parse(row.content)), updated: row.updated} : {draft: null, updated: null});
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const owner = await sessionOwner(request);
    if (!owner) return json({error: 'Sign in to keep a draft with your account.'}, 401);
    if (!await allowWrite('draft:' + owner, AUTOSAVES_PER_MINUTE)) return json({error: 'Saving the draft too often. It is kept on this page; try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    if ((raw as {account?: unknown})?.account !== await accountKey(owner)) return json({error: 'You are signed in to a different account in this browser now. Reload the page.', code: 'account_changed'}, 409);
    const draft = draftForStorage((raw as {content?: unknown})?.content);
    if (!draft) return json({error: 'Send the draft as {"content": <scope fields>}.'}, 400);
    const updated = new Date().toISOString();
    await db().prepare('INSERT INTO drafts (owner,content,updated) VALUES (?,?,?) ON CONFLICT (owner) DO UPDATE SET content=excluded.content, updated=excluded.updated').bind(owner, JSON.stringify(draft), updated).run();
    return json({updated});
  } catch (e) { return failure(e); }
}

export async function DELETE(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const owner = await sessionOwner(request);
    if (!owner) return json({error: 'Sign in to discard your draft.'}, 401);
    if (new URL(request.url).searchParams.get('account') !== await accountKey(owner)) return json({error: 'You are signed in to a different account in this browser now. Reload the page.', code: 'account_changed'}, 409);
    if (!await allowWrite('draft:' + owner, AUTOSAVES_PER_MINUTE)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    await db().prepare('DELETE FROM drafts WHERE owner=?').bind(owner).run();
    return json({deleted: true});
  } catch (e) { return failure(e); }
}
