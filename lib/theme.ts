// Themes (L9 / LT-18 / SF-21). Two visual themes share every component and differ only in tokens
// (app/globals.css): "a" = Etched (cream on grained cobalt), "b" = ScopeFlow original (default, cobalt ink
// on cream). Each has a light and a dark scheme. The owner picks the theme and a mode (light / dark /
// follow the system); the choice lives on <html data-theme data-mode data-scheme>, is kept in this browser
// and, when signed in, with the account (GET/PUT /api/theme, account_settings.theme_style/theme_mode).
// Client pages (/review/...) always follow the visitor's system scheme, whatever is stored in this browser.
// Pure module (no React import), so the root layout (a server component) can import the constants.
export const THEME_KEY = 'scopeflow:theme';
export const MODE_KEY = 'scopeflow:mode';
export type ThemeId = 'a' | 'b';
export type ModeId = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';
export type ThemeChoice = {theme: ThemeId; mode: ModeId};
export const THEMES: {id: ThemeId; name: string}[] = [
  {id: 'a', name: 'Etched'},
  {id: 'b', name: 'ScopeFlow original'},
];
export const MODES: {id: ModeId; name: string}[] = [
  {id: 'system', name: 'System'},
  {id: 'light', name: 'Light'},
  {id: 'dark', name: 'Dark'},
];
export const DEFAULT_CHOICE: ThemeChoice = {theme: 'b', mode: 'system'};
export const normalizeTheme = (value: unknown): ThemeId => (value === 'a' ? 'a' : 'b');
export const normalizeMode = (value: unknown): ModeId => (value === 'light' || value === 'dark' ? value : 'system');
export const resolveScheme = (mode: ModeId, prefersDark: boolean): Scheme => (mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode);
/** Pages a client sees: they follow the visitor's own system scheme, never a choice stored in this browser. */
export const isClientPath = (path: string) => /^\/review\//.test(path);
/** Parses a stored or posted preference; anything unknown becomes the default. */
export function parseChoice(raw: unknown): ThemeChoice {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {theme: normalizeTheme(r.theme), mode: normalizeMode(r.mode)};
}
/** Strict check for PUT /api/theme: null when the body is not a valid choice. */
export function validChoice(raw: unknown): ThemeChoice | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return (r.theme === 'a' || r.theme === 'b') && (r.mode === 'light' || r.mode === 'dark' || r.mode === 'system') ? {theme: r.theme, mode: r.mode} : null;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
// Applies the saved theme before first paint (inline in app/layout.tsx), so there is no flash and no shift.
export const themeScript = `try{var d=document.documentElement,s=localStorage,c=/^\\/review\\//.test(location.pathname),t=s.getItem('${THEME_KEY}'),m=s.getItem('${MODE_KEY}');t=t==='a'?'a':'b';m=c?'system':(m==='light'||m==='dark'?m:'system');d.dataset.theme=t;d.dataset.mode=m;d.dataset.scheme=m==='system'?(matchMedia('${DARK_QUERY}').matches?'dark':'light'):m}catch(e){}`;

const prefersDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
const onClientPage = () => typeof location !== 'undefined' && isClientPath(location.pathname);

/** Writes the choice to <html> (and this browser unless `store` is false). Client pages keep the system scheme. */
export function applyTheme(choice: ThemeChoice, {store = true}: {store?: boolean} = {}) {
  if (typeof document === 'undefined') return;
  const d = document.documentElement;
  const mode = onClientPage() ? 'system' : choice.mode;
  d.dataset.theme = choice.theme;
  d.dataset.mode = mode;
  d.dataset.scheme = resolveScheme(mode, prefersDark());
  if (store) try { localStorage.setItem(THEME_KEY, choice.theme); localStorage.setItem(MODE_KEY, choice.mode); } catch { /* storage unavailable: the choice lasts for this page */ }
}

function readChoice(): ThemeChoice & {scheme: Scheme} {
  const d = document.documentElement.dataset;
  return {theme: normalizeTheme(d.theme), mode: normalizeMode(d.mode), scheme: d.scheme === 'dark' ? 'dark' : 'light'};
}
export function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-scheme']});
  const media = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  const onMedia = () => { const c = readChoice(); if (c.mode === 'system') document.documentElement.dataset.scheme = resolveScheme('system', prefersDark()); };
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY || e.key === MODE_KEY) applyTheme(parseChoice({theme: localStorage.getItem(THEME_KEY), mode: localStorage.getItem(MODE_KEY)}), {store: false}); };
  media?.addEventListener('change', onMedia);
  window.addEventListener('storage', onStorage);
  return () => { observer.disconnect(); media?.removeEventListener('change', onMedia); window.removeEventListener('storage', onStorage); };
}
/** Snapshot string 'theme|mode|scheme' for useSyncExternalStore (see app/components/slots/theme-switcher.tsx). */
export const themeSnapshot = () => { const c = readChoice(); return `${c.theme}|${c.mode}|${c.scheme}`; };
export const serverThemeSnapshot = () => 'b|system|light';
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

// Set when /api/me reports a signed-in session, so returning owners get the compact workspace
// heading before first paint instead of the signed-out hero (avoids a layout shift).
export const SESSION_HINT_KEY = 'scopeflow:signed-in';
export function rememberSession(signedIn: boolean) {
  if (typeof document === 'undefined') return;
  if (signedIn) document.documentElement.dataset.auth = 'in'; else delete document.documentElement.dataset.auth;
  try { if (signedIn) localStorage.setItem(SESSION_HINT_KEY, '1'); else localStorage.removeItem(SESSION_HINT_KEY); } catch { /* storage unavailable */ }
}

/**
 * N5: the business-name colour on the client page. The owner's chosen text colour wins over the accent; either is
 * shaded until it reaches 4.5:1 on `background`. Null (so the page's own --ink applies) when nothing parses.
 */
export function brandNameInk(textColor: string | null | undefined, accent: string | null | undefined, background: string | null | undefined): string | null {
  return readableOn(textColor || accent, background, 4.5);
}
