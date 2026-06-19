import Decimal from 'decimal.js';
import type { ExpectedPayer } from '../types';
import { normalizeAccountNumber, normalizeName } from './normalize';

export const EXPECTED_PAYERS_STORAGE_KEY = 'ceramika-reconciliator-expected-payers';

export interface StoredExpectedPayer {
  id: string;
  studentName: string;
  parentName: string;
  accountNumber: string;
  expectedAmount: string;
  lessonGroup: string;
  notes: string;
}

export interface ExpectedPayersSnapshot {
  payers: StoredExpectedPayer[];
  savedAt: string;
  sourceFileName?: string;
}

export function payerStorageKey(payer: Pick<ExpectedPayer, 'studentName' | 'parentName' | 'accountNumber'>): string {
  return [
    normalizeName(payer.studentName),
    normalizeName(payer.parentName),
    normalizeAccountNumber(payer.accountNumber),
  ].join('|');
}

export function toStored(payer: ExpectedPayer): StoredExpectedPayer {
  return {
    id: payer.id,
    studentName: payer.studentName,
    parentName: payer.parentName,
    accountNumber: payer.accountNumber,
    expectedAmount: payer.expectedAmount.toFixed(2),
    lessonGroup: payer.lessonGroup,
    notes: payer.notes,
  };
}

export function fromStored(stored: StoredExpectedPayer): ExpectedPayer {
  return {
    id: stored.id,
    studentName: stored.studentName,
    parentName: stored.parentName,
    accountNumber: stored.accountNumber,
    normalizedAccount: normalizeAccountNumber(stored.accountNumber),
    expectedAmount: new Decimal(stored.expectedAmount),
    lessonGroup: stored.lessonGroup,
    notes: stored.notes,
  };
}

export function loadExpectedPayers(): ExpectedPayersSnapshot | null {
  try {
    const raw = localStorage.getItem(EXPECTED_PAYERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExpectedPayersSnapshot;
    if (!Array.isArray(parsed.payers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveExpectedPayers(
  payers: ExpectedPayer[],
  sourceFileName?: string,
): void {
  const existing = loadExpectedPayers();
  const snapshot: ExpectedPayersSnapshot = {
    payers: payers.map(toStored),
    savedAt: new Date().toISOString(),
    sourceFileName: sourceFileName ?? existing?.sourceFileName,
  };
  localStorage.setItem(EXPECTED_PAYERS_STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearExpectedPayers(): void {
  localStorage.removeItem(EXPECTED_PAYERS_STORAGE_KEY);
}

export function mergeImportedPayers(
  existing: ExpectedPayer[],
  imported: ExpectedPayer[],
): ExpectedPayer[] {
  const idsByKey = new Map(existing.map((p) => [payerStorageKey(p), p.id]));
  return imported.map((p) => ({
    ...p,
    id: idsByKey.get(payerStorageKey(p)) ?? p.id,
  }));
}

export function createEmptyPayer(): ExpectedPayer {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    studentName: '',
    parentName: '',
    accountNumber: '',
    normalizedAccount: '',
    expectedAmount: new Decimal(0),
    lessonGroup: '',
    notes: '',
  };
}

export function updatePayerField(
  payers: ExpectedPayer[],
  id: string,
  field: keyof Pick<
    ExpectedPayer,
    'studentName' | 'parentName' | 'accountNumber' | 'lessonGroup' | 'notes'
  >,
  value: string,
): ExpectedPayer[] {
  return payers.map((p) => {
    if (p.id !== id) return p;
    const updated = { ...p, [field]: value };
    if (field === 'accountNumber') {
      updated.normalizedAccount = normalizeAccountNumber(value);
    }
    return updated;
  });
}

export function updatePayerAmount(
  payers: ExpectedPayer[],
  id: string,
  value: string,
): ExpectedPayer[] {
  return payers.map((p) => {
    if (p.id !== id) return p;
    try {
      const amount = new Decimal(value.replace(',', '.') || '0');
      return { ...p, expectedAmount: amount };
    } catch {
      return p;
    }
  });
}
