// Units and counts in plain English (WS-09 LT-12): "1 concept", "3 concepts", never "×1 concepts".
const rules = new Intl.PluralRules('en-US');

/** Singular form of an English unit word ("concepts" → "concept", "revisions" → "revision", "boxes" → "box"). */
export function singular(word: string): string {
  const w = word.trim();
  if (/[^aeiou]ies$/i.test(w)) return w.slice(0, -3) + (w.endsWith('IES') ? 'Y' : 'y');
  if (/(ss|x|z|ch|sh)es$/i.test(w)) return w.slice(0, -2);
  if (/[^s]s$/i.test(w) && !/(us|is)$/i.test(w)) return w.slice(0, -1);
  return w;
}

/** Plural form of an English unit word ("concept" → "concepts", "copy" → "copies", "box" → "boxes"). */
export function pluralForm(word: string): string {
  const w = singular(word);
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + (w.endsWith('Y') ? 'IES' : 'ies');
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

/** "1 concept", "2 concepts", "1.5 hours". The last word of a multi-word unit takes the number ("1 A4 page"). */
export function plural(unit: string, count: number): string {
  const u = unit.trim();
  if (!u) return String(count);
  const parts = u.split(/\s+/);
  const last = parts.pop()!;
  const word = rules.select(count) === 'one' ? singular(last) : pluralForm(last);
  return `${count} ${[...parts, word].join(' ')}`;
}
