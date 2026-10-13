'use client';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog';
import {FIRST_FIELD_SELECTOR, shouldAnnounce} from '@/lib/a11y';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  /** One line that says what cannot be undone, shown in the consequence style. */
  consequence?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};

/**
 * UX-C41: an in-app replacement for window.confirm. `confirm(opts)` resolves true or false; the dialog is themed,
 * traps focus, closes on Esc (as Cancel) and returns focus to whatever had it before.
 */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<{opts: ConfirmOptions; open: boolean} | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setState({opts, open: true});
  }), []);
  const settle = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setState(s => s && {...s, open: false}); };
  useEffect(() => () => { resolver.current?.(false); }, []);
  const o = state?.opts;
  const node = <Dialog open={!!state?.open} onOpenChange={open => { if (!open) settle(false); }}>
    <DialogContent>
      {o && <>
        <DialogTitle>{o.title}</DialogTitle>
        {o.body ? <DialogDescription>{o.body}</DialogDescription> : <DialogDescription className="sr-only">{o.title}</DialogDescription>}
        {o.consequence && <p className="consequence">{o.consequence}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={() => settle(false)}>{o.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={o.danger ? 'primary danger' : 'primary'} onClick={() => settle(true)}>{o.confirmLabel}</button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
  return [confirm, node];
}

/**
 * UX-C42: a visually hidden status line that speaks `message` only after it has stayed the same for `delay` ms
 * and differs from what it last announced. Nothing is announced on first render.
 */
export function SettledStatus({message, delay = 1000}: {message: string; delay?: number}) {
  const [spoken, setSpoken] = useState('');
  const last = useRef<string | null>(message);
  useEffect(() => {
    const id = setTimeout(() => { if (shouldAnnounce(last.current, message)) { last.current = message; setSpoken(message); } }, delay);
    return () => clearTimeout(id);
  }, [message, delay]);
  return <p className="sr-only" role="status" aria-atomic="true">{spoken}</p>;
}

/** UX-C46: move focus to the first field inside `root` (after it renders), without scrolling it twice. */
export function focusFirstField(root: HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    const el = root?.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR);
    el?.focus({preventScroll: true});
  });
}

/** UX-C46: put focus back on the control that opened a form, when it is still on the page. */
export function restoreFocus(el: HTMLElement | null | undefined, fallback?: HTMLElement | null) {
  requestAnimationFrame(() => {
    const target = el && el.isConnected && !(el as HTMLButtonElement).disabled ? el : fallback;
    target?.focus({preventScroll: false});
  });
}
