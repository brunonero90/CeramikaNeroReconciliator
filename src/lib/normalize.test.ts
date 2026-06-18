import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  accountsMatch,
  normalizeAccountNumber,
  normalizeName,
  parseAmount,
} from './normalize';

describe('normalizeAccountNumber', () => {
  it('removes spaces and dashes', () => {
    expect(normalizeAccountNumber('12 1020 1026 0000 0102 0123 4567')).toBe(
      '12102010260000010201234567',
    );
    expect(normalizeAccountNumber('12-1020-1026-0000-0102-0123-4567')).toBe(
      '12102010260000010201234567',
    );
  });

  it('removes PL prefix from IBAN and keeps last 26 digits when longer', () => {
    expect(normalizeAccountNumber('PL12 1020 1026 0000 0102 0123 4567')).toBe(
      '12102010260000010201234567',
    );
    expect(normalizeAccountNumber('PL9912345678901234567890123456')).toBe(
      '12345678901234567890123456',
    );
  });

  it('compares last 26 digits for Polish accounts', () => {
    const a = 'PL12 1020 1026 0000 0102 0123 4567';
    const b = '12 1020 1026 0000 0102 0123 4567';
    expect(accountsMatch(a, b)).toBe(true);
  });
});

describe('normalizeName', () => {
  it('lowercases and removes Polish accents', () => {
    expect(normalizeName('  Ewa   Wiśniewska  ')).toBe('ewa wisniewska');
    expect(normalizeName('Łukasz Żółć')).toBe('lukasz zolc');
  });
});

describe('parseAmount', () => {
  it('parses comma decimals', () => {
    expect(parseAmount('250,00')?.toFixed(2)).toBe('250.00');
    expect(parseAmount('-250,00')?.toFixed(2)).toBe('-250.00');
  });

  it('parses dot decimals', () => {
    expect(parseAmount('250.00')?.toFixed(2)).toBe('250.00');
  });

  it('handles mBank negative amounts', () => {
    const amount = parseAmount('-250,00');
    expect(amount?.lt(0)).toBe(true);
  });
});

describe('decimal-safe money', () => {
  it('avoids floating point errors', () => {
    const a = new Decimal('0.1');
    const b = new Decimal('0.2');
    expect(a.plus(b).equals(new Decimal('0.3'))).toBe(true);
  });
});
