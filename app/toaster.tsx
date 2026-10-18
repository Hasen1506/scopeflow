'use client';
import dynamic from 'next/dynamic';
import {useEffect, useState} from 'react';

// Sonner is only needed once a toast fires. Mount it after the first paint so it is not on the LCP path.
const Toaster = dynamic(() => import('sonner').then(m => m.Toaster), {ssr: false});

export function LazyToaster() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => { setTimeout(() => setOn(true), 0); });
    return () => cancelAnimationFrame(id);
  }, []);
  if (!on) return null;
  return <Toaster position="bottom-center" duration={2600} />;
}
