'use client';
import {useEffect} from 'react';

// Registers public/sw-share.js (no caching; it only makes the installed app a share target, SF-03).
// Mounted on /share here; WS-09 mounts it once in app/layout.tsx next to the manifest link.
export default function PwaSetup() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
    navigator.serviceWorker.register('/sw-share.js', {scope: '/'}).catch(() => undefined);
  }, []);
  return null;
}
