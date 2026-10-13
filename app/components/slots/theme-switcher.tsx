'use client';
// Slot: ThemeSwitcher. Owner: WS-09 (implements it). Mounted by: WS-09 (the header in app/ui.tsx).
// Theme A/B switch plus colour mode (system / light / dark), and the ThemeProvider that keeps the
// choice in step with the signed-in account. State and DOM helpers live in lib/theme.ts.
import {useEffect, useSyncExternalStore, type ReactNode} from 'react';
import {THEMES, MODES, applyTheme, fromSnapshot, isClientPath, parseChoice, serverThemeSnapshot, subscribeTheme, syncThemeColor, themeSnapshot, type ModeId, type ThemeChoice, type ThemeId} from '@/lib/theme';

export function useTheme() {
  return fromSnapshot(useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot));
}

const signedIn = () => document.documentElement.dataset.auth === 'in';

/** Saves the choice with the account when signed in (best effort: the browser copy already holds it). */
export async function saveChoice(choice: ThemeChoice) {
  applyTheme(choice);
  if (!signedIn()) return;
  try { await fetch('/api/theme', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(choice)}); } catch { /* offline: kept in this browser */ }
}

/** Loads the account's saved theme once signed in, so it follows the owner to any browser. */
export function ThemeProvider({children}: {children?: ReactNode}) {
  // UX-C57: the theme set before paint also sets the browser chrome colour.
  useEffect(() => { syncThemeColor(); }, []);
  useEffect(() => {
    if (isClientPath(location.pathname)) return;
    let last = '';
    const sync = async () => {
      if (!signedIn() || last === 'in') { if (!signedIn()) last = ''; return; }
      last = 'in';
      try {
        const r = await fetch('/api/theme', {cache: 'no-store'});
        const data = r.ok ? await r.json() : null;
        if (data?.theme) applyTheme(parseChoice(data));
      } catch { /* keep the browser copy */ }
    };
    void sync();
    const observer = new MutationObserver(() => { void sync(); });
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-auth']});
    return () => observer.disconnect();
  }, []);
  return <>{children}</>;
}

export type ThemeSwitcherProps = {className?: string};

/** Small persistent switch: theme A/B and colour mode. */
export default function ThemeSwitcher({className = ''}: ThemeSwitcherProps) {
  const {theme, mode} = useTheme();
  const set = (next: Partial<ThemeChoice>) => { void saveChoice({theme, mode, ...next}); };
  return (
    <div className={`theme-switch ${className}`.trim()} role="group" aria-label="Theme">
      {THEMES.map(t => (
        <button key={t.id} type="button" aria-pressed={theme === t.id} title={`Theme ${t.id.toUpperCase()}: ${t.name}`} aria-label={`Theme ${t.id.toUpperCase()}, ${t.name}`} onClick={() => set({theme: t.id as ThemeId})}>
          <span className="theme-letter" aria-hidden="true">{t.id.toUpperCase()}</span><span className="theme-name" aria-hidden="true">{t.id === 'a' ? 'Etched' : 'Original'}</span>
        </button>
      ))}
      <select aria-label="Colour mode" value={mode} onChange={e => set({mode: e.target.value as ModeId})}>
        {MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    </div>
  );
}
