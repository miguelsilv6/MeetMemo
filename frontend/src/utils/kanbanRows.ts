// Row layout for the Kanban (bubble) view: every segment gets its own row, in
// chronological order, so reading top to bottom follows the conversation no
// matter which speaker column a bubble sits in.

export type KanbanRow =
  { kind: 'segment'; index: number } | { kind: 'silence'; durationSeconds: number };

/** Pauses at least this long (nobody speaking) get a divider row. */
export const SILENCE_LABEL_THRESHOLD_SECONDS = 20;

export function buildKanbanRows(
  segments: { start: number | string; end: number | string }[]
): KanbanRow[] {
  const ordered = segments
    .map((segment, index) => ({ index, start: Number(segment.start), end: Number(segment.end) }))
    .sort((a, b) => a.start - b.start || a.index - b.index);

  const rows: KanbanRow[] = [];
  // Latest end seen so far, so a long segment overlapping later ones isn't
  // mistaken for silence after it.
  let speechEnd: number | null = null;
  for (const item of ordered) {
    if (speechEnd !== null && item.start - speechEnd >= SILENCE_LABEL_THRESHOLD_SECONDS) {
      rows.push({ kind: 'silence', durationSeconds: item.start - speechEnd });
    }
    rows.push({ kind: 'segment', index: item.index });
    speechEnd = speechEnd === null ? item.end : Math.max(speechEnd, item.end);
  }
  return rows;
}
