import {db, json, ownerAuth, body, safeOrigin, allowWrite, allowRead, failure} from '@/lib/server';
import {validChoice} from '@/lib/theme';

// The owner's theme (L9 / SF-21): theme 'a' | 'b' and mode 'light' | 'dark' | 'system', stored in
// account_settings.theme_style / theme_mode (migration 0024). Browser sessions only. GET answers 200 with
// {signedIn:false} when signed out, so the ThemeProvider never logs an error on public pages.
type Row = {theme_style: string | null; theme_mode: string | null};
async function sessionOwner(request: Request) {
  const auth = await ownerAuth(request);
  return auth?.via === 'session' ? auth.user : null;
}

export async function GET(request: Request) {
  try {
    const owner = await sessionOwner(request);
    if (!owner) return json({signedIn: false, theme: null, mode: null});
    if (!await allowRead('owner:' + owner)) return json({error: 'Too many requests. Try again in a minute.'}, 429);
    const row = await db().prepare('SELECT theme_style,theme_mode FROM account_settings WHERE owner=?').bind(owner).first<Row>();
    return json({signedIn: true, theme: row?.theme_style ?? null, mode: row?.theme_mode ?? null});
  } catch (e) { return failure(e); }
}

export async function PUT(request: Request) {
  try {
    if (!safeOrigin(request)) return json({error: 'Origin not allowed.'}, 403);
    const owner = await sessionOwner(request);
    if (!owner) return json({error: 'Sign in to keep your theme with your account.'}, 401);
    if (!await allowWrite('theme:' + owner, 30)) return json({error: 'Changing the theme too often. Try again in a minute.'}, 429);
    let raw;
    try { raw = await body(request); } catch { return json({error: 'Provide valid JSON under 24 KB.'}, 400); }
    const choice = validChoice(raw);
    if (!choice) return json({error: 'Choose theme "a" or "b" and mode "light", "dark" or "system".', fields: {theme: 'Choose A or B', mode: 'Choose light, dark or system'}}, 400);
    await db().prepare('INSERT INTO account_settings (owner,theme_style,theme_mode,updated) VALUES (?,?,?,?) ON CONFLICT (owner) DO UPDATE SET theme_style=excluded.theme_style,theme_mode=excluded.theme_mode,updated=excluded.updated')
      .bind(owner, choice.theme, choice.mode, new Date().toISOString()).run();
    return json({theme: choice.theme, mode: choice.mode});
  } catch (e) { return failure(e); }
}
