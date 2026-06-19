import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { ExpectedPayer } from '../types';
import {
  fromStored,
  mergeImportedPayers,
  payerStorageKey,
  toStored,
} from './expectedPayersStorage';

function makePayer(overrides: Partial<ExpectedPayer> & Pick<ExpectedPayer, 'studentName'>): ExpectedPayer {
  return {
    id: overrides.id ?? 'id-1',
    parentName: overrides.parentName ?? 'Rodzic',
    accountNumber: overrides.accountNumber ?? '12 1020 1026 0000 0102 0123 4567',
    normalizedAccount: '102010260000010201234567',
    expectedAmount: overrides.expectedAmount ?? new Decimal('250'),
    lessonGroup: overrides.lessonGroup ?? '',
    notes: overrides.notes ?? '',
    ...overrides,
  };
}

describe('expectedPayersStorage', () => {
  it('roundtrips payer through stored format', () => {
    const payer = makePayer({ studentName: 'Zofia', expectedAmount: new Decimal('340.5') });
    const restored = fromStored(toStored(payer));
    expect(restored.studentName).toBe('Zofia');
    expect(restored.expectedAmount.toFixed(2)).toBe('340.50');
    expect(restored.normalizedAccount).toBeTruthy();
  });

  it('preserves ids when re-importing same student', () => {
    const existing = [
      makePayer({
        id: 'stable-id',
        studentName: 'Zofia',
        parentName: 'Anna',
        accountNumber: 'PL12 1020 1026 0000 0102 0123 4567',
      }),
    ];
    const imported = [
      makePayer({
        id: 'new-id',
        studentName: 'Zofia',
        parentName: 'Anna',
        accountNumber: '12 1020 1026 0000 0102 0123 4567',
        expectedAmount: new Decimal('360'),
      }),
    ];
    const merged = mergeImportedPayers(existing, imported);
    expect(merged[0].id).toBe('stable-id');
    expect(merged[0].expectedAmount.toFixed(2)).toBe('360.00');
  });

  it('builds stable storage keys', () => {
    const key = payerStorageKey({
      studentName: 'Zofia',
      parentName: 'Anna',
      accountNumber: 'PL12 1020 1026 0000 0102 0123 4567',
    });
    expect(key).toContain('zofia');
    expect(key).toContain('anna');
  });
});
