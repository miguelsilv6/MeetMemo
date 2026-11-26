import { describe, it, expect } from 'vitest';
import { findProducts } from './productFolders';

function file(path: string): File {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const f = new File(['x'], name);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

describe('findProducts', () => {
  it('pairs the audio in __CLIENT__ with the TranslatedPRI.xml above it', () => {
    const files = [
      file('2414/RawData/e153.vsf'),
      file('2414/RawData/e153_PRI.xml'),
      file('2414/__CLIENT__/e153c371-f8fc.wav'),
      file('2414/Pri.json'),
      file('2414/Pri.xml'),
      file('2414/TranslatedPRI.xml'),
    ];

    const [product, ...rest] = findProducts(files);

    expect(rest).toEqual([]);
    expect(product.audio.name).toBe('e153c371-f8fc.wav');
    expect(product.callRecord?.webkitRelativePath).toBe('2414/TranslatedPRI.xml');
    expect(product.folder).toBe('2414');
  });

  it('gives each product of a case folder its own record', () => {
    const files = [
      file('Caso/2414/__CLIENT__/a.wav'),
      file('Caso/2414/TranslatedPRI.xml'),
      file('Caso/2415/__CLIENT__/b.wav'),
      file('Caso/2415/TranslatedPRI.xml'),
      file('Caso/2416/__CLIENT__/c.wav'), // no record: imported without one
    ];

    const products = findProducts(files);

    expect(products.map((p) => [p.audio.name, p.callRecord?.webkitRelativePath ?? null])).toEqual([
      ['a.wav', 'Caso/2414/TranslatedPRI.xml'],
      ['b.wav', 'Caso/2415/TranslatedPRI.xml'],
      ['c.wav', null],
    ]);
  });

  it('takes audios from anywhere when there is no __CLIENT__ folder', () => {
    const products = findProducts([
      file('pasta/chamada.mp3'),
      file('pasta/translatedpri.XML'), // the name in any case
      file('pasta/notas.txt'),
    ]);

    expect(products).toHaveLength(1);
    expect(products[0].callRecord?.name).toBe('translatedpri.XML');
  });

  it('finds nothing without audio', () => {
    expect(findProducts([file('p/TranslatedPRI.xml'), file('p/RawData/x.bin')])).toEqual([]);
  });
});
