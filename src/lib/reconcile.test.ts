import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Decimal from 'decimal.js';
import type { BankTransaction, ExpectedPayer } from '../types';
import {
  extractFromMbankDescription,
  parseBankCsv,
  stripMbankMetadata,
} from './parseBankCsv';
import { reconcile } from './reconcile';
import { combinedNameScore } from './fuzzyMatch';
import { generateId } from './normalize';

function makePayer(
  overrides: Partial<ExpectedPayer> & Pick<ExpectedPayer, 'studentName' | 'parentName' | 'expectedAmount'>,
): ExpectedPayer {
  return {
    id: generateId(),
    accountNumber: overrides.accountNumber ?? '',
    normalizedAccount: overrides.normalizedAccount ?? '',
    lessonGroup: overrides.lessonGroup ?? '',
    notes: overrides.notes ?? '',
    ...overrides,
  };
}

function makeTx(
  overrides: Partial<BankTransaction> & Pick<BankTransaction, 'amount'>,
): BankTransaction {
  return {
    id: generateId(),
    date: '2025-06-01',
    senderAccount: overrides.senderAccount ?? '',
    normalizedAccount: overrides.normalizedAccount ?? '',
    senderName: overrides.senderName ?? '',
    title: overrides.title ?? '',
    currency: 'PLN',
    rawIndex: 0,
    ...overrides,
  };
}

describe('parseBankCsv', () => {
  const csv = `#Data operacji;#Tytuł;#Nadawca/Odbiorca;#Numer rachunku kontrahenta;#Kwota;#Waluta
2025-06-03;Zajęcia;ANNA KOWALSKA;PL12 1020 1026 0000 0102 0123 4567;250,00;PLN
2025-06-10;Wypłata;BANKOMAT;;-250,00;PLN`;

  it('parses semicolon-separated mBank CSV', () => {
    const result = parseBankCsv(csv);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount.toFixed(2)).toBe('250.00');
    expect(result.skippedOutgoing).toBe(1);
  });

  it('parses mBank lista operacji export with metadata header', () => {
    const listaCsv = `mBank S.A. Bankowość Detaliczna;
#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2026-05-29;"SEARGIN SPÓŁKA, Zapłata za: 11/2026 PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY 93105017641000009031361570";"mBiznes konto Standard 3911 ... 9842";"Wpływy - inne";30 996,00 PLN;
2026-05-28;"BRUNO NERO, PRZELEW ŚRODKÓW PRZELEW WŁASNY 87114020040000390282652282";"mBiznes konto Standard 3911 ... 9842";"Przelew własny";-3 000,00 PLN;`;

    const result = parseBankCsv(listaCsv);
    expect(result.errors.filter((e) => e.includes('Nie znaleziono'))).toHaveLength(0);
    expect(result.transactions).toHaveLength(1);
    expect(result.skippedOutgoing).toBe(1);
    expect(result.transactions[0].amount.toFixed(2)).toBe('30996.00');
    expect(result.transactions[0].senderName).toContain('SEARGIN');
    expect(result.transactions[0].senderAccount).toBe('93105017641000009031361570');
  });

  it('extracts counterparty from mBank opis operacji', () => {
    const extracted = extractFromMbankDescription(
      'ANNA KOWALSKA, Zajęcia ceramiczne PRZELEW ZEWNĘTRZNY PRZYCHODZĄCY 93105017641000009031361570',
    );
    expect(extracted.senderName).toBe('ANNA KOWALSKA');
    expect(extracted.senderAccount).toBe('93105017641000009031361570');
  });

  it('parses full real mBank lista operacji export file', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(
      resolve(dir, '__fixtures__/mbank_lista_operacji.csv'),
      'utf8',
    );

    expect(stripMbankMetadata(content).split('\n')[0]).toContain('Data operacji');

    const result = parseBankCsv(content);
    expect(result.errors.filter((e) => e.includes('Nie znaleziono'))).toHaveLength(0);
    expect(result.errors.filter((e) => e.includes('Too few fields'))).toHaveLength(0);
    expect(result.transactions.length).toBeGreaterThanOrEqual(5);
    expect(result.skippedOutgoing).toBeGreaterThanOrEqual(10);
    expect(result.transactions[0].senderAccount).toMatch(/^\d{26}$/);
  });

  it('parses Ceramika Nero zestawienie operacji export', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const content = readFileSync(
      resolve(dir, '__fixtures__/ceramika_nero_mbank_maj2026.csv'),
      'utf8',
    );

    const result = parseBankCsv(content);
    expect(result.errors.filter((e) => e.includes('Nie znaleziono'))).toHaveLength(0);
    expect(result.transactions.length).toBeGreaterThanOrEqual(20);
    expect(result.transactions[0].senderAccount).toMatch(/^\d{26}$/);
    expect(result.transactions[0].senderName.length).toBeGreaterThan(0);
    expect(result.transactions[0].title.length).toBeGreaterThan(0);
  });
});

describe('reconcile', () => {
  it('matches by account number', () => {
    const payers = [
      makePayer({
        studentName: 'Zofia',
        parentName: 'Anna Kowalska',
        accountNumber: 'PL12 1020 1026 0000 0102 0123 4567',
        normalizedAccount: '102010260000010201234567',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('250'),
        senderAccount: 'PL12 1020 1026 0000 0102 0123 4567',
        normalizedAccount: '102010260000010201234567',
        senderName: 'ANNA KOWALSKA',
        title: 'Zajęcia',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows[0].status).toBe('PAID');
    expect(result.summary.paidCount).toBe(1);
  });

  it('sums multiple payments from same parent', () => {
    const payers = [
      makePayer({
        studentName: 'Kacper',
        parentName: 'Robert Malinowski',
        normalizedAccount: '105000991234567890123456',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('150'),
        normalizedAccount: '105000991234567890123456',
        senderName: 'ROBERT MALINOWSKI',
      }),
      makeTx({
        amount: new Decimal('100'),
        normalizedAccount: '105000991234567890123456',
        senderName: 'ROBERT MALINOWSKI',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows[0].status).toBe('PAID');
    expect(result.rows[0].paidAmount.toFixed(2)).toBe('250.00');
    expect(result.rows[0].matchedTransactions).toHaveLength(2);
  });

  it('detects underpayment', () => {
    const payers = [
      makePayer({
        studentName: 'Kacper',
        parentName: 'Robert',
        normalizedAccount: '105000991234567890123456',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('150'),
        normalizedAccount: '105000991234567890123456',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows[0].status).toBe('UNDERPAID');
    expect(result.summary.underpaidCount).toBe(1);
  });

  it('detects overpayment', () => {
    const payers = [
      makePayer({
        studentName: 'Zofia',
        parentName: 'Anna',
        normalizedAccount: '102010260000010201234567',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('300'),
        normalizedAccount: '102010260000010201234567',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows[0].status).toBe('OVERPAID');
    expect(result.summary.overpaidCount).toBe(1);
  });

  it('detects unknown payment', () => {
    const payers = [
      makePayer({
        studentName: 'Zofia',
        parentName: 'Anna',
        normalizedAccount: '102010260000010201234567',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('999'),
        normalizedAccount: '99999999999999999999999999',
        senderName: 'NIKOŁAJ BARSZCZ',
        title: 'Zajęcia',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows[0].status).toBe('MISSING');
    expect(result.unknownPayments).toHaveLength(1);
    expect(result.summary.unknownCount).toBe(1);
  });

  it('splits one payment for siblings on same account', () => {
    const account = '114020040000300234567890';
    const payers = [
      makePayer({
        studentName: 'Maja',
        parentName: 'Ewa Wiśniewska',
        normalizedAccount: account,
        expectedAmount: new Decimal('200'),
      }),
      makePayer({
        studentName: 'Tomasz',
        parentName: 'Ewa Wiśniewska',
        normalizedAccount: account,
        expectedAmount: new Decimal('200'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('400'),
        normalizedAccount: account,
        senderName: 'EWA WISNIEWSKA',
        title: 'Zajęcia Maja i Tomasz',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.rows.every((r) => r.status === 'PAID')).toBe(true);
  });

  it('detects ambiguous match when same amount for many students', () => {
    const payers = [
      makePayer({
        studentName: 'Alicja',
        parentName: 'Parent A',
        expectedAmount: new Decimal('250'),
      }),
      makePayer({
        studentName: 'Bartek',
        parentName: 'Parent B',
        expectedAmount: new Decimal('250'),
      }),
      makePayer({
        studentName: 'Celina',
        parentName: 'Parent C',
        expectedAmount: new Decimal('250'),
      }),
    ];
    const txs = [
      makeTx({
        amount: new Decimal('250'),
        senderName: 'JAN KOWALSKI',
        title: 'Przelew',
      }),
    ];

    const result = reconcile(payers, txs);
    expect(result.unknownPayments.length).toBeGreaterThan(0);
    expect(result.summary.ambiguousCount + result.summary.unknownCount).toBeGreaterThan(0);
  });
});

describe('fuzzyNameMatch', () => {
  it('matches parent name in sender despite accents', () => {
    const score = combinedNameScore(
      'Ewa Wiśniewska',
      'Maja Wiśniewska',
      'EWA WISNIEWSKA',
      'Zajęcia Maja',
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('matches student name in title', () => {
    const score = combinedNameScore(
      'Marta Zielińska',
      'Lena Zielińska',
      'MARTA ZIELINSKA',
      'Ceramika Lena',
    );
    expect(score).toBeGreaterThan(0.5);
  });
});
