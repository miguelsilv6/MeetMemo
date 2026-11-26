import { describe, it, expect } from 'vitest';
import { columnsOf, elementsOf, fieldLabel, formatCallDuration } from './callRecord';
import type { CallRecordElement } from '../types/api';

describe('callRecord helpers', () => {
  it('reads durations like a clock', () => {
    expect(formatCallDuration(58)).toBe('0:58');
    expect(formatCallDuration(605)).toBe('10:05');
    expect(formatCallDuration(3725)).toBe('1:02:05');
    expect(formatCallDuration(null)).toBeNull();
  });

  it('turns the file’s attribute names into words', () => {
    expect(fieldLabel('Hora_de_início')).toBe('Hora de início');
  });

  it('groups elements and lists every column any of them has', () => {
    const elements: CallRecordElement[] = [
      { tag: 'Etiqueta', attributes: { Hora: '1', Tipo: 'A' } },
      { tag: 'Ficheiros_de_produtos', attributes: { Nome: 'x' } },
      { tag: 'Etiqueta', attributes: { Hora: '2', Evento: 'E' } },
    ];
    const events = elementsOf(elements, 'Etiqueta');
    expect(events).toHaveLength(2);
    expect(columnsOf(events)).toEqual(['Hora', 'Tipo', 'Evento']);
  });
});
