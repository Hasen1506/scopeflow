'use client';
// "Jump to" links for a long settings page: one link per section heading (h2 with an id) inside the
// nearest <main>, collected after render so it always matches the sections actually shown.
import {useEffect, useRef, useState} from 'react';

export function SectionNav({refreshKey}: {refreshKey?: unknown}) {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<{id: string; label: string}[]>([]);
  useEffect(() => {
    const root = ref.current?.closest('main');
    if (!root) return;
    const next = [...root.querySelectorAll<HTMLHeadingElement>('h2[id]')].map(h => ({id: h.id, label: (h.textContent || '').trim()})).filter(x => x.label);
    // Collected from the DOM after render: the sections depend on the account's mode and data.
    setItems(next);
  }, [refreshKey]);
  return <nav ref={ref} className="section-nav" aria-label="On this page" hidden={items.length < 4}>
    <span className="section-nav-label">Jump to</span>
    <ul>{items.map(x => <li key={x.id}><a href={'#' + x.id}>{x.label}</a></li>)}</ul>
  </nav>;
}
