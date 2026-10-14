import { describe, it, expect } from 'vitest';
import {
  packResearchReferences,
  unpackResearchReferences,
} from './survival-size-codec';
describe('experimental reference codec, never used by client persistence', () => {
  it('round trips JSON without rounding scores, changing ordering or colliding with r keys', () => {
    const input = {
      players: [
        { id: 'human', score: 1.2345, items: [{ r: 0, itemId: 'd6' }] },
        { id: 'human', score: 1.2345, items: [{ r: 0, itemId: 'd6' }] },
      ],
      null: null,
      text: '中文事件',
      flag: true,
    };
    const packed = packResearchReferences(input);
    const result = unpackResearchReferences(packed);
    expect(JSON.stringify(result)).toBe(JSON.stringify(input));
    expect((result as typeof input).players[0]).not.toBe(
      (result as typeof input).players[1],
    );
  });
  it('rejects non-finite numbers and invalid/forward references', () => {
    expect(() => packResearchReferences({ score: Infinity })).toThrow();
    expect(() =>
      unpackResearchReferences({
        format: 'survival-research-references-1',
        root: { r: 0 },
        nodes: [{ a: [{ r: 0 }] }],
      }),
    ).toThrow('forward');
  });
  it('keeps empty collections, zero and false distinct', () => {
    const input = [0, false, null, '', [], {}];
    expect(unpackResearchReferences(packResearchReferences(input))).toEqual(
      input,
    );
  });
});
