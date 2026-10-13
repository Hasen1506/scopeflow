'use client';
import {useEffect, useRef} from 'react';

/**
 * UX-C52: publishes the sticky save bar's height as --save-bar-h on <html>, so the notice dock above it clears the
 * bar whatever it holds (block reason, draft-sync line, hints). Render it inside the bar; it draws nothing.
 */
export function SaveBarHeight() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = ref.current?.parentElement;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--save-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(bar);
    return () => { observer.disconnect(); root.style.removeProperty('--save-bar-h'); };
  }, []);
  return <span ref={ref} hidden />;
}
