'use client';
import {createContext, useContext} from 'react';

export const TryContext = createContext<() => void>(() => {});

/** Opens the editor without an account. Used from server-rendered landing sections. */
export function TryEditorButton({className, children}: {className?: string; children: React.ReactNode}) {
  const onTry = useContext(TryContext);
  return <button type="button" className={className} onClick={onTry}>{children}</button>;
}
