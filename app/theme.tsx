'use client';
import {useSyncExternalStore} from 'react';
import {THEME_KEY, THEMES, normalizeTheme, type ThemeId} from '@/lib/theme';

// The theme lives on <html data-theme>, set before paint by the inline script in app/layout.tsx.
function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  const onStorage = (e: StorageEvent) => { if (e.key === THEME_KEY) { document.documentElement.dataset.theme = normalizeTheme(e.newValue); } };
  window.addEventListener('storage', onStorage);
  return () => { observer.disconnect(); window.removeEventListener('storage', onStorage); };
}
const read = (): ThemeId => normalizeTheme(document.documentElement.dataset.theme);

export function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem(THEME_KEY, id); } catch { /* storage unavailable: the choice lasts for this page */ }
}

/** Small persistent A/B switch for the two design directions. */
export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, read, () => 'b' as ThemeId);
  return (
    <div className="theme-switch" role="group" aria-label="Design theme">
      {THEMES.map(t => (
        <button key={t.id} type="button" aria-pressed={theme === t.id} title={`Theme ${t.id.toUpperCase()}: ${t.name}`} aria-label={`Theme ${t.id.toUpperCase()}, ${t.name}`} onClick={() => setTheme(t.id)}>
          {t.id.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
