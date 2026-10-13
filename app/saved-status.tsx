'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Check} from 'lucide-react';

/** UX-C27: a short "Saved" confirmation for controls that save as soon as they change. */
export function useSavedFlash(ms = 2000) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), ms);
  }, [ms]);
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current); setSaved(false); }, []);
  return {saved, flash, clear};
}

/** The live region stays mounted (empty when idle) so screen readers announce "Saved" politely when it appears. */
export function SavedNote({saved, label = 'Saved'}: {saved: boolean; label?: string}) {
  return <p className="saved-note" role="status" aria-live="polite">{saved ? <><Check size={14} aria-hidden="true" />{label}</> : null}</p>;
}
