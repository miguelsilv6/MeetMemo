import { useState } from 'react';

/** Order of a list by import date. */
export type SortOrder = 'newest' | 'oldest';

function readStoredOrder(key: string, fallback: SortOrder): SortOrder {
  try {
    const stored = localStorage.getItem(key);
    return stored === 'newest' || stored === 'oldest' ? stored : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The order chosen for a list, remembered in this browser under `key`.
 * Without storage (private mode, blocked) the choice just isn't remembered.
 */
export function useSortOrder(key: string, fallback: SortOrder) {
  const [order, setOrder] = useState<SortOrder>(() => readStoredOrder(key, fallback));
  const changeOrder = (next: SortOrder) => {
    setOrder(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not remembered; the list is still sorted.
    }
  };
  return [order, changeOrder] as const;
}

/** A copy of `items` sorted by their `created_at` (ISO dates), missing dates last. */
export function sortByDate<T extends { created_at?: string | null }>(
  items: T[],
  order: SortOrder
): T[] {
  return [...items].sort((a, b) => {
    if (!a.created_at || !b.created_at) {
      return (a.created_at ? 0 : 1) - (b.created_at ? 0 : 1);
    }
    const diff = a.created_at.localeCompare(b.created_at);
    return order === 'newest' ? -diff : diff;
  });
}
