import Papa from 'papaparse';
import type { ExpectedPayer } from '../types';
import { generateId, normalizeAccountNumber, normalizeHeader, parseAmount } from './normalize';

const REQUIRED_COLUMNS = [
  'student_name',
  'parent_name',
  'account_number',
  'expected_amount',
] as const;

const COLUMN_ALIASES: Record<string, string[]> = {
  student_name: ['student_name', 'student', 'uczen', 'imie ucznia', 'dziecko', 'nazwa ucznia'],
  parent_name: ['parent_name', 'parent', 'rodzic', 'imie rodzica', 'platnik', 'payer'],
  account_number: [
    'account_number',
    'account',
    'nr konta',
    'numer konta',
    'konto',
    'iban',
    'rachunek',
  ],
  expected_amount: [
    'expected_amount',
    'amount',
    'kwota',
    'oplata',
    'czesne',
    'expected',
    'naleznosc',
  ],
  lesson_group: ['lesson_group', 'group', 'grupa', 'zajecia'],
  notes: ['notes', 'notatki', 'uwagi', 'note'],
};

function resolveColumn(headers: string[], field: string): string | null {
  const aliases = COLUMN_ALIASES[field] ?? [field];
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (aliases.includes(normalized)) {
      return header;
    }
  }
  return null;
}

export interface ParseExpectedResult {
  payers: ExpectedPayer[];
  errors: string[];
}

export function parseExpectedCsv(content: string): ParseExpectedResult {
  const errors: string[] = [];

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map((e) => `CSV: ${e.message}`));
  }

  const headers = parsed.meta.fields ?? [];
  const columnMap: Record<string, string | null> = {};
  for (const col of [...REQUIRED_COLUMNS, 'lesson_group', 'notes']) {
    columnMap[col] = resolveColumn(headers, col);
  }

  for (const col of REQUIRED_COLUMNS) {
    if (!columnMap[col]) {
      errors.push(`Brak wymaganej kolumny: ${col}`);
    }
  }

  if (errors.some((e) => e.startsWith('Brak wymaganej'))) {
    return { payers: [], errors };
  }

  const payers: ExpectedPayer[] = [];

  parsed.data.forEach((row, index) => {
    const studentName = (row[columnMap.student_name!] ?? '').trim();
    const parentName = (row[columnMap.parent_name!] ?? '').trim();
    const accountNumber = (row[columnMap.account_number!] ?? '').trim();
    const amountRaw = row[columnMap.expected_amount!];
    const lessonGroup = columnMap.lesson_group
      ? (row[columnMap.lesson_group] ?? '').trim()
      : '';
    const notes = columnMap.notes ? (row[columnMap.notes] ?? '').trim() : '';

    if (!studentName && !parentName) return;

    const expectedAmount = parseAmount(amountRaw);
    if (!expectedAmount || expectedAmount.lte(0)) {
      errors.push(`Wiersz ${index + 2}: nieprawidłowa kwota "${amountRaw}"`);
      return;
    }

    payers.push({
      id: generateId(),
      studentName,
      parentName,
      accountNumber,
      normalizedAccount: normalizeAccountNumber(accountNumber),
      expectedAmount,
      lessonGroup,
      notes,
    });
  });

  return { payers, errors };
}
