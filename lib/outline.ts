// An unsaved outline from a brief. No model call and nothing is stored. The assistant
// shows this to the user, then saves a real scope only after they confirm the full text.

export type Outline = {
  saved: false;
  outline: {
    title: string;
    deliverables: {id: string; title: string}[];
    note: string;
  };
};

/** First line becomes the title; later non-empty lines become deliverable titles. */
export function outlineFromBrief(brief: string): Outline {
  const lines = brief.split(/\n+/).map(s => s.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const rawTitle = (lines[0] || 'Untitled scope').slice(0, 160);
  const title = rawTitle.length >= 3 ? rawTitle : 'Untitled scope';
  const deliverables = lines.slice(lines[0] && rawTitle.length >= 3 ? 1 : 0, 12).map((line, i) => ({id: 'd' + (i + 1), title: line.slice(0, 200)}));
  return {
    saved: false,
    outline: {
      title,
      deliverables,
      note: 'Unsaved outline from the brief. Nothing was stored and no fee, date or client was invented. Fill those in with the user, then save with create_scope only after they have reviewed the full scope.',
    },
  };
}
