import type {Ws} from './state';

/** UX-C10: the tracker's state for a step card; current and attention cards get emphasis (globals.css). */
export const stepState = (w: Ws, id: string): 'current' | 'attention' | undefined => {
  const s = w.steps.find(x => x.id === id)?.state;
  return s === 'current' || s === 'attention' ? s : undefined;
};
