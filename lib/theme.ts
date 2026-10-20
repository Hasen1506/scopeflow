// Themes. The owner picks one of three appearances. Internally they still map onto the token
// sets in app/globals.css: "b"+light = Light (cream), "b"+dark = Dark, "a"+light = Etched
// (cream type on grained cobalt). "system" remains a stored mode so older rows and the review
// page still parse; the switcher never writes it.
// One choice: the sf-appearance cookie (light | dark | etched). The pre-paint script and React
// both read it. localStorage keeps the older theme/mode keys in step. When nothing is saved,
// the appearance is Etched and it is not written, so a later default can still change.
// The choice also lives on <html data-theme data-mode data-scheme> and, when signed in, on the
// account (GET/PUT /api/theme). Client pages (/review/...) follow the visitor's system scheme.
// Pure module (no React import), so the root layout can import the constants.
export const THEME_KEY = 'scopeflow:theme';
export const MODE_KEY = 'scopeflow:mode';
export const APPEARANCE_COOKIE = 'sf-appearance';
export type ThemeId = 'a' | 'b';
export type ModeId = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';
export type Appearance = 'light' | 'dark' | 'etched';
export type ThemeChoice = {theme: ThemeId; mode: ModeId};
export const APPEARANCES: {id: Appearance; name: string}[] = [
  {id: 'light', name: 'Light'},
  {id: 'dark', name: 'Dark'},
  {id: 'etched', name: 'Etched'},
];
export const DEFAULT_APPEARANCE: Appearance = 'etched';
export const DEFAULT_CHOICE: ThemeChoice = {theme: 'a', mode: 'light'};
export const normalizeTheme = (value: unknown): ThemeId => (value === 'a' ? 'a' : 'b');
export const normalizeMode = (value: unknown): ModeId => (value === 'dark' || value === 'system' ? value : 'light');
export const resolveScheme = (mode: ModeId, prefersDark: boolean): Scheme => (mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode === 'dark' ? 'dark' : 'light');
/** The three appearances. Etched is one look. A legacy "system" mode is pinned to the current scheme once. */
export function appearanceOf(choice: ThemeChoice, prefersDark = false): Appearance {
  if (choice.theme === 'a') return 'etched';
  if (choice.mode === 'dark' || (choice.mode === 'system' && prefersDark)) return 'dark';
  return 'light';
}
export function choiceForAppearance(appearance: Appearance): ThemeChoice {
  if (appearance === 'etched') return {theme: 'a', mode: 'light'};
  if (appearance === 'dark') return {theme: 'b', mode: 'dark'};
  return {theme: 'b', mode: 'light'};
}
export function appearanceFromCookieValue(value: string | null | undefined): Appearance | null {
  return value === 'light' || value === 'dark' || value === 'etched' ? value : null;
}
/** Cookie wins. Otherwise an explicit legacy pair. Nothing stored → null (the caller uses Etched and does not persist it). */
export function resolveAppearance(input: {cookie: string | null; theme: string | null; mode: string | null; prefersDark: boolean}): {appearance: Appearance; explicit: boolean} {
  const cookie = appearanceFromCookieValue(input.cookie);
  if (cookie) return {appearance: cookie, explicit: true};
  if (input.theme == null && input.mode == null) return {appearance: DEFAULT_APPEARANCE, explicit: false};
  if (input.theme === 'a') return {appearance: 'etched', explicit: true};
  if (input.mode === 'dark' || (input.mode !== 'light' && input.prefersDark)) return {appearance: 'dark', explicit: true};
  return {appearance: 'light', explicit: true};
}
export function snapshotFor(appearance: Appearance): string {
  const choice = choiceForAppearance(appearance);
  const scheme: Scheme = choice.mode === 'dark' ? 'dark' : 'light';
  return `${choice.theme}|${choice.mode}|${scheme}`;
}
/** Pages a client sees: they follow the visitor's own system scheme, never a choice stored in this browser. */
export const isClientPath = (path: string) => /^\/review\//.test(path);
/** Parses a stored or posted preference. An empty body is the default (Etched). A present but unknown theme stays Light, so a stray value does not wipe an explicit mode. */
export function parseChoice(raw: unknown): ThemeChoice {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.theme == null && r.mode == null) return {theme: DEFAULT_CHOICE.theme, mode: DEFAULT_CHOICE.mode};
  return {theme: normalizeTheme(r.theme), mode: normalizeMode(r.mode)};
}
/** Strict check for PUT /api/theme: null when the body is not a valid choice. */
export function validChoice(raw: unknown): ThemeChoice | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return (r.theme === 'a' || r.theme === 'b') && (r.mode === 'light' || r.mode === 'dark' || r.mode === 'system') ? {theme: r.theme, mode: r.mode} : null;
}

// Set when a signed-in session is known, so returning owners get the workspace before first paint
// instead of the signed-out hero. Read by the pre-paint script and by rememberSession.
export const SESSION_HINT_KEY = 'scopeflow:signed-in';
const DARK_QUERY = '(prefers-color-scheme: dark)';
// Applies the saved appearance before first paint. The cookie is the choice; legacy localStorage
// is read only when the cookie is absent, and then copied into the cookie. Nothing saved stays
// Etched and is not written. Owner pages never stay on "system". Review pages still follow the OS scheme.
export const themeScript = `try{var d=document.documentElement,c=/^\\/review\\//.test(location.pathname),dark=matchMedia('${DARK_QUERY}').matches,cm=document.cookie.match(/(?:^|; )${APPEARANCE_COOKIE}=([^;]*)/),cv=cm?decodeURIComponent(cm[1]):'',appearance=cv==='light'||cv==='dark'||cv==='etched'?cv:'',tr=null,mr=null;try{tr=localStorage.getItem('${THEME_KEY}');mr=localStorage.getItem('${MODE_KEY}')}catch(e){}if(!appearance){if(tr==null&&mr==null)appearance='etched';else if(tr==='a')appearance='etched';else if(mr==='dark'||(mr!=='light'&&dark))appearance='dark';else appearance='light';if(!(tr==null&&mr==null))document.cookie='${APPEARANCE_COOKIE}='+appearance+'; Path=/; Max-Age=31536000; SameSite=Lax'}var theme=appearance==='etched'?'a':'b',mode=appearance==='dark'?'dark':'light';if(c){d.dataset.theme=theme;d.dataset.mode='system';d.dataset.scheme=dark?'dark':'light'}else{d.dataset.theme=theme;d.dataset.mode=mode;d.dataset.scheme=mode}}catch(e){}`;
// Parser-blocking boot: theme, the signed-in hint, and a capture-phase listener so a click on
// Sign in (or any /auth/ link) loads that document directly. next/script beforeInteractive only
// queues this until the deferred framework bundle runs, which is after first paint: the marketing
// page and the wrong theme would paint first. The layout inlines this string as a real script.
export const bootScript = `${themeScript}try{if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')document.documentElement.dataset.auth='in'}catch(e){}document.addEventListener('click',function(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var t=e.target,a=t&&t.closest?t.closest('a'):null;if(!a||!a.href||(a.target&&a.target!=='_self'))return;var u;try{u=new URL(a.href,location.href)}catch(err){return}if(u.origin!==location.origin||u.pathname.indexOf('/auth/')!==0)return;e.preventDefault();location.assign(u.pathname+u.search+u.hash)},true);`;

const prefersDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
const onClientPage = () => typeof location !== 'undefined' && isClientPath(location.pathname);

const safeGet = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export function readCookieAppearance(cookieHeader = typeof document === 'undefined' ? '' : document.cookie): Appearance | null {
  const match = cookieHeader.match(new RegExp('(?:^|; )' + APPEARANCE_COOKIE + '=([^;]*)'));
  if (!match) return null;
  try { return appearanceFromCookieValue(decodeURIComponent(match[1])); } catch { return null; }
}
function writeAppearanceCookie(appearance: Appearance) {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${APPEARANCE_COOKIE}=${appearance}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
/** Null when this browser has not chosen. The cookie wins over the legacy keys. */
export function readAppearance(): Appearance | null {
  if (typeof document === 'undefined') return null;
  const resolved = resolveAppearance({cookie: readCookieAppearance(), theme: safeGet(THEME_KEY), mode: safeGet(MODE_KEY), prefersDark: prefersDark()});
  return resolved.explicit ? resolved.appearance : null;
}
/** Changes when the saved choice changes. An account theme is applied only while this is empty. */
export const storedStamp = () => (readCookieAppearance() ?? '') + '|' + (safeGet(THEME_KEY) ?? '') + '|' + (safeGet(MODE_KEY) ?? '');
export function readStoredChoice(): ThemeChoice | null {
  const appearance = readAppearance();
  return appearance ? choiceForAppearance(appearance) : null;
}
let themeFrame = 0;
function writeDataset(theme: ThemeId, mode: ModeId, scheme: Scheme) {
  const d = document.documentElement;
  if (d.dataset.theme === theme && d.dataset.mode === mode && d.dataset.scheme === scheme) return;
  // Snap tokens. A colour transition during the swap is a frame of mixed themes.
  // Only the latest change removes the class, after the new colours have painted.
  const frame = ++themeFrame;
  d.classList.add('theme-changing');
  d.dataset.theme = theme;
  d.dataset.mode = mode;
  d.dataset.scheme = scheme;
  const clear = () => { if (frame === themeFrame) d.classList.remove('theme-changing'); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(clear));
  else clear();
}
let applying = false;
/** Re-applies the saved appearance after hydration. React must not own these attributes (see app/layout.tsx). */
export function applyBoot() {
  if (applying || typeof document === 'undefined') return;
  applying = true;
  try {
    restoreSessionHint();
    const appearance = readAppearance();
    const choice = choiceForAppearance(appearance ?? DEFAULT_APPEARANCE);
    if (onClientPage()) applyTheme({...choice, mode: 'system'}, {store: false});
    else applyTheme(choice, {store: appearance != null});
  } finally { applying = false; }
}
export function restoreSessionHint() {
  if (typeof document === 'undefined') return;
  try { if (localStorage.getItem(SESSION_HINT_KEY) === '1') document.documentElement.dataset.auth = 'in'; } catch { /* storage unavailable */ }
}

/** Writes the choice to <html> (and this browser unless `store` is false). Client pages keep the system scheme. */
export function applyTheme(choice: ThemeChoice, {store = true}: {store?: boolean} = {}) {
  if (typeof document === 'undefined') return;
  if (onClientPage()) {
    const next = choiceForAppearance(appearanceOf(choice, prefersDark()));
    writeDataset(next.theme, 'system', resolveScheme('system', prefersDark()));
    if (store) {
      writeAppearanceCookie(appearanceOf(next));
      try { localStorage.setItem(THEME_KEY, next.theme); localStorage.setItem(MODE_KEY, next.mode); } catch { /* storage unavailable: the choice lasts for this page */ }
    }
    syncThemeColor();
    return;
  }
  const next = choiceForAppearance(appearanceOf(choice, prefersDark()));
  writeDataset(next.theme, next.mode, next.mode === 'dark' ? 'dark' : 'light');
  if (store) {
    writeAppearanceCookie(appearanceOf(next));
    try { localStorage.setItem(THEME_KEY, next.theme); localStorage.setItem(MODE_KEY, next.mode); } catch { /* storage unavailable: the choice lasts for this page */ }
  }
  syncThemeColor();
}

/** UX-C57: the browser chrome colour (<meta name=theme-color>) follows the page background of the applied theme. */
export function syncThemeColor() {
  if (typeof document === 'undefined') return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!bg) return;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.setAttribute('content', bg); m.removeAttribute('media'); });
}

function readChoice(): ThemeChoice & {scheme: Scheme} {
  const d = document.documentElement.dataset;
  return {theme: normalizeTheme(d.theme), mode: normalizeMode(d.mode), scheme: d.scheme === 'dark' ? 'dark' : 'light'};
}
export function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-scheme']});
  const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  const onMedia = () => { const c = readChoice(); if (c.mode === 'system') { document.documentElement.dataset.scheme = resolveScheme('system', prefersDark()); syncThemeColor(); } };
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === MODE_KEY) applyTheme(parseChoice({theme: localStorage.getItem(THEME_KEY), mode: localStorage.getItem(MODE_KEY)}), {store: false}); };
  media?.addEventListener('change', onMedia);
  window.addEventListener('storage', onStorage);
  return () => { observer.disconnect(); media?.removeEventListener('change', onMedia); window.removeEventListener('storage', onStorage); };
}
/** Snapshot string 'theme|mode|scheme' for useSyncExternalStore (see app/components/slots/theme-switcher.tsx).
 * Owner pages follow the cookie (the same value the pre-paint script applied). Review pages follow the DOM, because their scheme is the visitor's. */
export const themeSnapshot = () => {
  if (!onClientPage()) {
    const appearance = readAppearance();
    if (appearance) return snapshotFor(appearance);
  }
  const c = readChoice();
  return `${c.theme}|${c.mode}|${c.scheme}`;
};
export const serverThemeSnapshot = () => snapshotFor(DEFAULT_APPEARANCE);
export function fromSnapshot(key: string): ThemeChoice & {scheme: Scheme} {
  const [theme, mode, scheme] = key.split('|');
  return {theme: normalizeTheme(theme), mode: normalizeMode(mode), scheme: scheme === 'dark' ? 'dark' : 'light'};
}

// ---- Contrast (WCAG 2.x), used by tests/property/ws-09-theme.test.mjs over the tokens in globals.css ----
type RGBA = [number, number, number, number];
export function parseColor(value: string): RGBA | null {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) { const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA; }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] == null ? 1 : Number(rgb[4])] : null;
}
/** Composites a (possibly translucent) colour over an opaque one. */
export const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map(i => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]: RGBA) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrastRatio(fg: RGBA, bg: RGBA): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const hex = (c: RGBA) => '#' + c.slice(0, 3).map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
/**
 * A version of `color` that reads on `background` at `min`:1 (4.5 for text, 3 for a rule), keeping its hue: the
 * colour itself when it already passes, otherwise mixed toward black on a light background or toward white on a
 * dark one, in small steps until it passes (UX-C05: owner brand colours on the client page, which follows the
 * visitor's light or dark scheme). Null when either value is not a colour.
 */
export function readableOn(color: string | null | undefined, background: string | null | undefined, min = 4.5): string | null {
  const fg = color ? parseColor(color) : null, bg = background ? parseColor(background) : null;
  if (!fg || !bg) return null;
  const solid = over(fg, bg), back = over(bg, [255, 255, 255, 1]);
  if (contrastRatio(parseColor(hex(solid))!, back) >= min) return hex(solid);
  const toward: RGBA = luminance(back) > 0.18 ? [0, 0, 0, 1] : [255, 255, 255, 1];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const c = hex([0, 1, 2].map(i => solid[i] * (1 - t) + toward[i] * t).concat(1) as RGBA);
    if (contrastRatio(parseColor(c)!, back) >= min) return c;
  }
  return hex(toward);
}

export function rememberSession(signedIn: boolean) {
  if (typeof document === 'undefined') return;
  if (signedIn) document.documentElement.dataset.auth = 'in'; else delete document.documentElement.dataset.auth;
  try { if (signedIn) localStorage.setItem(SESSION_HINT_KEY, '1'); else localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable */ }
}
/** Drops the stored hint without uncovering the marketing page on the document that is about to unload. */
export function clearSessionHint() {
  try { localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable */ }
}

/**
 * N5: the business-name colour on the client page. The owner's chosen text colour wins over the accent; either is
 * shaded until it reaches 4.5:1 on `background`. Null (so the page's own --ink applies) when nothing parses.
 */
export function brandNameInk(textColor: string | null | undefined, accent: string | null | undefined, background: string | null | undefined): string | null {
  return readableOn(textColor || accent, background, 4.5);
}
