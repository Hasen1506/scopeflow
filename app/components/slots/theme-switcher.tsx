'use client';
// Slot: ThemeSwitcher. Owner: WS-09 (implements it). Mounted by: WS-09 (the header in app/ui.tsx).
// Four colour squares (each theme in light and dark), and the ThemeProvider that keeps the choice in step
// with the signed-in account. Until the owner picks one, the page follows the device's light or dark setting
// and the matching square is marked. State and DOM helpers live in lib/theme.ts.
import {useEffect, useSyncExternalStore, type CSSProperties, type ReactNode} from 'react';
import {SWATCHES, applyTheme, fromSnapshot, isClientPath, parseChoice, serverThemeSnapshot, subscribeTheme, syncThemeColor, themeSnapshot, type ThemeChoice} from '@/lib/theme';

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

/** Small persistent switch: one square per look, filled with that look's background and ink. */
export default function ThemeSwitcher({className = ''}: ThemeSwitcherProps) {
  const {theme, scheme} = useTheme();
  return (
    <div className={`theme-switch ${className}`.trim()} role="group" aria-label="Colours">
      {SWATCHES.map(s => (
        <button key={s.name} type="button" className="swatch" aria-pressed={theme === s.theme && scheme === s.scheme} aria-label={s.name} title={s.name}
          style={{'--sw-bg': s.bg, '--sw-ink': s.ink} as CSSProperties} onClick={() => { void saveChoice({theme: s.theme, mode: s.scheme}); }}>
          <span aria-hidden="true"/>
        </button>
      ))}
    </div>
  );
}
