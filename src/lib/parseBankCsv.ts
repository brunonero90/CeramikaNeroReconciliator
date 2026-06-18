import Papa from 'papaparse';
import Decimal from 'decimal.js';
import type { BankTransaction } from '../types';
import { generateId, normalizeAccountNumber, normalizeHeader, parseAmount } from './normalize';

const DATE_ALIASES = [
  'data',
  'data operacji',
  'data ksiegowania',
  'data ksiegowania operacji',
  'data transakcji',
  'date',
  'transaction date',
  'booking date',
];

const ACCOUNT_ALIASES = [
  'rachunek kontrahenta',
  'konto kontrahenta',
  'nr rachunku kontrahenta',
  'numer rachunku kontrahenta',
  'konto nadawcy',
  'rachunek nadawcy',
  'konto zleceniodawcy',
  'account',
  'account number',
  'sender account',
  'counterparty account',
  'iban',
];

const SENDER_ALIASES = [
  'kontrahent',
  'nazwa kontrahenta',
  'nadawca',
  'zleceniodawca',
  'sender',
  'sender name',
  'name',
  'nazwa',
];

const TITLE_ALIASES = [
  'tytul',
  'tytul operacji',
  'tytul przelewu',
  'opis',
  'opis operacji',
  'title',
  'description',
  'reference',
];

const AMOUNT_ALIASES = [
  'kwota',
  'kwota operacji',
  'amount',
  'wartosc',
  'wartosc operacji',
  'kwota w walucie rachunku',
];

const CURRENCY_ALIASES = ['waluta', 'currency', 'waluta operacji'];

function findColumn(headers: string[], aliases: string[]): string | null {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const header of headers) {
    const nh = normalizeHeader(header);
    if (normalizedAliases.includes(nh)) {
      return header;
    }
    for (const alias of normalizedAliases) {
      if (nh.includes(alias) || alias.includes(nh)) {
        return header;
      }
    }
  }
  return null;
}

function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

export interface ParseBankResult {
  transactions: BankTransaction[];
  errors: string[];
  skippedOutgoing: number;
}

export function parseBankCsv(content: string): ParseBankResult {
  const errors: string[] = [];
  const delimiter = detectDelimiter(content);

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter,
    transformHeader: (h) => h.trim(),
  });

  if (parsed.errors.length > 0) {
    errors.push(...parsed.errors.map((e) => `CSV banku: ${e.message}`));
  }

  const headers = parsed.meta.fields ?? [];
  const dateCol = findColumn(headers, DATE_ALIASES);
  const accountCol = findColumn(headers, ACCOUNT_ALIASES);
  const senderCol = findColumn(headers, SENDER_ALIASES);
  const titleCol = findColumn(headers, TITLE_ALIASES);
  const amountCol = findColumn(headers, AMOUNT_ALIASES);
  const currencyCol = findColumn(headers, CURRENCY_ALIASES);

  if (!dateCol) errors.push('Nie znaleziono kolumny z datą transakcji.');
  if (!amountCol) errors.push('Nie znaleziono kolumny z kwotą.');
  if (errors.length > 0) {
    return { transactions: [], errors, skippedOutgoing: 0 };
  }

  const transactions: BankTransaction[] = [];
  let skippedOutgoing = 0;

  parsed.data.forEach((row, index) => {
    const amount = parseAmount(row[amountCol!]);
    if (!amount) {
      errors.push(`Wiersz ${index + 2}: nieprawidłowa kwota`);
      return;
    }

    if (amount.lte(0)) {
      skippedOutgoing += 1;
      return;
    }

    const senderAccount = accountCol ? (row[accountCol] ?? '').trim() : '';
    const senderName = senderCol ? (row[senderCol] ?? '').trim() : '';
    const title = titleCol ? (row[titleCol] ?? '').trim() : '';
    const date = dateCol ? (row[dateCol] ?? '').trim() : '';
    const currency = currencyCol ? (row[currencyCol] ?? 'PLN').trim() : 'PLN';

    transactions.push({
      id: generateId(),
      date,
      senderAccount,
      normalizedAccount: normalizeAccountNumber(senderAccount),
      senderName,
      title,
      amount,
      currency,
      rawIndex: index,
    });
  });

  return { transactions, errors, skippedOutgoing };
}

export function isIncomingAmount(amount: Decimal): boolean {
  return amount.gt(0);
}
