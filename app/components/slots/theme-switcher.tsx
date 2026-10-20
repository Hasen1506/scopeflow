'use client';
// Slot: ThemeSwitcher. Owner: WS-09 (side rail). Light, Dark and Etched.
// ThemeProvider re-applies the saved choice after hydration and, on a browser with nothing
// stored, copies the signed-in account's choice. It never overwrites a choice made locally
// while that request was in flight.
import {useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {APPEARANCES, applyBoot, applyTheme, appearanceOf, choiceForAppearance, fromSnapshot, isClientPath, parseChoice, readAppearance, serverThemeSnapshot, subscribeTheme, syncThemeColor, themeSnapshot, type Appearance, type ThemeChoice} from '@/lib/theme';

export function useTheme() {
  return fromSnapshot(useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot));
}

const signedIn = () => document.documentElement.dataset.auth === 'in';

/** Saves the choice in this browser immediately, then with the account when signed in. A later account read cannot overwrite it: applyTheme writes the cookie before the request returns. */
export async function saveChoice(choice: ThemeChoice) {
  const next = choiceForAppearance(appearanceOf(choice));
  applyTheme(next);
  if (!signedIn()) return;
  try { await fetch('/api/theme', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(next)}); } catch { /* offline: kept in this browser */ }
}

/** Keeps <html> in step with the saved appearance, including after a refresh resets attributes. */
export function ThemeProvider({children}: {children?: ReactNode}) {
  const pathname = usePathname();
  useLayoutEffect(() => {
    // Forms in the HTML can be submitted before hydration. Mark the document once React is
    // attached so those controls start accepting input (see html:not(.hydrated) in globals.css).
    document.documentElement.classList.add('hydrated');
    applyBoot();
    syncThemeColor();
    // React must not own data-theme. If a refresh puts the server default back, put the cookie back.
    const observer = new MutationObserver(() => applyBoot());
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-scheme']});
    return () => observer.disconnect();
  }, [pathname]);
  useEffect(() => {
    if (isClientPath(location.pathname)) return;
    let cancelled = false;
    const sync = async () => {
      if (cancelled || !signedIn() || readAppearance()) return;
      try {
        const r = await fetch('/api/theme', {cache: 'no-store'});
        const data = r.ok ? await r.json() : null;
        if (cancelled || readAppearance() || !data?.theme) return;
        applyTheme(choiceForAppearance(appearanceOf(parseChoice(data))));
      } catch { /* keep the browser copy */ }
    };
    void sync();
    const observer = new MutationObserver(() => { void sync(); });
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-auth']});
    return () => { cancelled = true; observer.disconnect(); };
  }, [pathname]);
  return <>{children}</>;
}

export type ThemeSwitcherProps = {className?: string};

/** Three appearances, stacked in the side rail. */
export default function ThemeSwitcher({className = ''}: ThemeSwitcherProps) {
  const {theme, mode, scheme} = useTheme();
  // Review pages store mode "system" and paint the visitor's scheme. The pressed
  // button follows that paint, so a dark review page does not keep Light selected.
  const current = appearanceOf({theme, mode}, scheme === 'dark');
  return (
    <div className={`theme-switch ${className}`.trim()} role="group" aria-label="Theme">
      {APPEARANCES.map(item => (
        <button key={item.id} type="button" aria-pressed={current === item.id} aria-label={item.name} onClick={() => { void saveChoice(choiceForAppearance(item.id as Appearance)); }}>
          <span className="theme-name">{item.name}</span>
        </button>
      ))}
    </div>
  );
}
