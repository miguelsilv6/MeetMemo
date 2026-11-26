import type { CallRecordElement } from '../types/api';

/** 58 → "0:58"; 3725 → "1:02:05". */
export function formatCallDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(hours ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** An attribute name of the file as words: "Hora_de_início" → "Hora de início". */
export function fieldLabel(name: string): string {
  return name.replace(/_/g, ' ');
}

/** The record's elements of one kind (participants, cells, events...), in file order. */
export function elementsOf(elements: CallRecordElement[], tag: string): CallRecordElement[] {
  return elements.filter((element) => element.tag === tag);
}

/** The columns of a group of elements: every attribute any of them has, in first-seen order. */
export function columnsOf(elements: CallRecordElement[]): string[] {
  const columns: string[] = [];
  for (const element of elements) {
    for (const name of Object.keys(element.attributes)) {
      if (!columns.includes(name)) columns.push(name);
    }
  }
  return columns;
}
