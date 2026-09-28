import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from '../src';

describe('PIN', () => {
  it('vérifie le bon PIN et refuse les autres', () => {
    const stored = hashPin('4821');
    expect(verifyPin('4821', stored)).toBe(true);
    expect(verifyPin('4822', stored)).toBe(false);
    expect(verifyPin('4821', null)).toBe(false);
  });

  it('sale chaque hachage différemment', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'));
  });

  it('refuse un PIN mal formé', () => {
    expect(() => hashPin('12a4')).toThrow();
    expect(verifyPin('123', hashPin('1234'))).toBe(false);
  });
});
