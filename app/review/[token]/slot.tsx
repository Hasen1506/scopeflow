'use client';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import styles from './client.module.css';

/**
 * Mounts a slot component owned by another workstream (PayBlock, CoCard, RetainerCounter…) and
 * keeps the page's own fallback until the slot renders something. Phase 0 slots render nothing, so
 * the client page keeps every feature it has today; once the owner ships the slot, its markup
 * replaces the fallback without another change here. `onFilled` tells the page so it can hide
 * fallbacks rendered elsewhere (e.g. the per-invoice pay buttons once the single PayBlock shows).
 */
export function SlotOr({name, children, fallback = null, onFilled}: {name: string; children: ReactNode; fallback?: ReactNode; onFilled?: (filled: boolean) => void}) {
  const ref = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(false);
  const notify = useRef(onFilled);
  useEffect(() => { notify.current = onFilled; }, [onFilled]);
  useEffect(() => { notify.current?.(filled); }, [filled]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFilled(el.childNodes.length > 0);
    const observer = new MutationObserver(check);
    observer.observe(el, {childList: true});
    queueMicrotask(check);
    return () => observer.disconnect();
  }, []);
  return <><div ref={ref} className={styles.slot} data-slot={name}>{children}</div>{!filled && fallback}</>;
}
