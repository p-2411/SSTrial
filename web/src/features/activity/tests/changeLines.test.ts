import { describe, expect, it } from 'vitest';
import { diffLines, fieldLines, foldUnchanged } from '../changeLines.ts';

describe('fieldLines', () => {
  it('writes a value out a line per item, and nothing for no value', () => {
    expect(fieldLines('brand', 'Oatly')).toEqual(['Oatly']);
    expect(fieldLines('brand', null)).toEqual([]);
    expect(fieldLines('allergens', ['oats', 'milk'])).toEqual(['oats', 'milk']);
    expect(
      fieldLines('ingredients', [
        { name: 'Rolled oats', percent: 48, subIngredients: [], allergens: ['oats'] },
        { name: 'Seasoning', percent: null, subIngredients: ['salt', 'pepper'], allergens: [] },
      ]),
    ).toEqual(['Rolled oats 48%', 'Seasoning (salt, pepper)']);
  });

  it("gives the pack's wording for an amount when it says more than the amount", () => {
    expect(fieldLines('netWeight', { value: 454, unit: 'g', text: 'Net Wt 16 oz (454 g)' })).toEqual(['454 g (Net Wt 16 oz (454 g))']);
    expect(fieldLines('netWeight', { value: 1.5, unit: 'l', text: '1.5 L' })).toEqual(['1.5 L']);
  });

  it('keeps values saved in an older shape readable', () => {
    expect(fieldLines('ingredients', ['Rolled OATS (48%)'])).toEqual(['Rolled OATS (48%)']);
  });
});

describe('diffLines', () => {
  it('keeps what both have, in order, and marks the rest removed or added', () => {
    expect(diffLines(['oats', 'milk', 'salt'], ['oats', 'honey', 'salt'])).toEqual([
      { kind: 'same', text: 'oats' },
      { kind: 'removed', text: 'milk' },
      { kind: 'added', text: 'honey' },
      { kind: 'same', text: 'salt' },
    ]);
    expect(diffLines([], ['Oatly'])).toEqual([{ kind: 'added', text: 'Oatly' }]);
    expect(diffLines(['Oatly'], [])).toEqual([{ kind: 'removed', text: 'Oatly' }]);
  });
});

describe('foldUnchanged', () => {
  it('folds long runs of unchanged lines, keeping one either side of each change', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g'];
    expect(foldUnchanged(diffLines(before, after))).toEqual([
      { kind: 'unchanged', count: 2 },
      { kind: 'same', text: 'c' },
      { kind: 'removed', text: 'd' },
      { kind: 'added', text: 'D' },
      { kind: 'same', text: 'e' },
      { kind: 'unchanged', count: 2 },
    ]);
  });

  it("doesn't fold a single line: saying it's there takes as much room", () => {
    expect(foldUnchanged(diffLines(['a', 'b', 'c'], ['a', 'b', 'C']))).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'removed', text: 'c' },
      { kind: 'added', text: 'C' },
    ]);
  });
});
