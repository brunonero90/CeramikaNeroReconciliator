import type { ReconciliationRow } from '../types';
import { formatMoneyPlain } from './normalize';

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes(';') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvLine(fields: string[]): string {
  return fields.map(escapeCsvField).join(';');
}

export function exportFullReconciliationCsv(rows: ReconciliationRow[]): string {
  const headers = [
    'student_name',
    'parent_name',
    'expected_amount',
    'paid_amount',
    'difference',
    'status',
    'confidence',
    'matched_transactions',
    'notes',
    'lesson_group',
  ];

  const lines = [rowToCsvLine(headers)];

  for (const row of rows) {
    const matched = row.matchedTransactions
      .map(
        (m) =>
          `${m.transaction.date}|${m.transaction.senderName}|${formatMoneyPlain(m.transaction.amount)}`,
      )
      .join(' ; ');

    lines.push(
      rowToCsvLine([
        row.payer.studentName,
        row.payer.parentName,
        formatMoneyPlain(row.expectedAmount),
        formatMoneyPlain(row.paidAmount),
        formatMoneyPlain(row.difference),
        row.status,
        row.confidence.toFixed(2),
        matched,
        row.notes,
        row.payer.lessonGroup,
      ]),
    );
  }

  return lines.join('\n');
}

export function exportMissingUnderpaidCsv(rows: ReconciliationRow[]): string {
  const filtered = rows.filter(
    (r) => r.status === 'MISSING' || r.status === 'UNDERPAID',
  );

  const headers = [
    'student_name',
    'parent_name',
    'expected_amount',
    'paid_amount',
    'difference',
    'status',
    'lesson_group',
    'notes',
  ];

  const lines = [rowToCsvLine(headers)];

  for (const row of filtered) {
    lines.push(
      rowToCsvLine([
        row.payer.studentName,
        row.payer.parentName,
        formatMoneyPlain(row.expectedAmount),
        formatMoneyPlain(row.paidAmount),
        formatMoneyPlain(row.difference.abs()),
        row.status,
        row.payer.lessonGroup,
        row.notes,
      ]),
    );
  }

  return lines.join('\n');
}

export function generateReminderText(row: ReconciliationRow, monthLabel?: string): string {
  const month = monthLabel ?? 'bieżący miesiąc';
  const owed = row.status === 'MISSING'
    ? formatMoneyPlain(row.expectedAmount)
    : formatMoneyPlain(row.difference.abs());

  return (
    `Dzień dobry ${row.payer.parentName},\n` +
    `przypominamy o opłacie za zajęcia ceramiczne (${month}) dla ${row.payer.studentName}.\n` +
    `Kwota do uregulowania: ${owed.replace('.', ',')} zł.\n` +
    `Dziękujemy!`
  );
}

export function downloadCsv(content: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
