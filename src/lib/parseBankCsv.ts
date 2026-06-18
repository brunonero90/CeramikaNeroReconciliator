import Papa from 'papaparse';
import Decimal from 'decimal.js';
import type { BankTransaction } from '../types';
import { generateId, normalizeAccountNumber, normalizeHeader, parseAmount } from './normalize';

const DATE_ALIASES = [
  'data operacji',
  'data ksiegowania',
  'data ksiegowania operacji',
  'data transakcji',
  'transaction date',
  'booking date',
];

const SENDER_ALIASES = [
  'kontrahent',
  'nazwa kontrahenta',
  'nadawca',
  'nadawca/odbiorca',
  'zleceniodawca',
  'sender',
  'sender name',
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

function headerMatchesAlias(header: string, alias: string): boolean {
  const nh = normalizeHeader(header);
  const na = normalizeHeader(alias);
  if (!nh || !na) return false;
  if (nh === na) return true;
  if (na.length >= 5 && nh.includes(na)) return true;
  return false;
}

function findColumn(headers: string[], aliases: string[]): string | null {
  for (const header of headers) {
    if (!header?.trim()) continue;
    for (const alias of aliases) {
      if (headerMatchesAlias(header, alias)) {
        return header;
      }
    }
  }
  return null;
}

function findCounterpartyAccountColumn(headers: string[]): string | null {
  for (const header of headers) {
    if (!header?.trim()) continue;
    const nh = normalizeHeader(header);
    if (
      nh.includes('kontrahent') ||
      nh.includes('nadawcy') ||
      nh.includes('zleceniodawcy') ||
      nh.includes('counterparty')
    ) {
      return header;
    }
  }
  for (const header of headers) {
    if (!header?.trim()) continue;
    const nh = normalizeHeader(header);
    if (nh.includes('iban') || nh === 'account' || nh === 'account number') {
      return header;
    }
  }
  return null;
}

function detectDelimiter(line: string): string {
  const semicolons = (line.match(/;/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function splitLines(content: string): string[] {
  return content.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
}

function isTransactionHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes(';')) return false;

  const cells = trimmed
    .split(';')
    .map((cell) => normalizeHeader(cell.trim()))
    .filter(Boolean);

  const hasDate = cells.some(
    (cell) =>
      cell === 'data operacji' ||
      cell === 'data ksiegowania' ||
      cell.startsWith('data operacji') ||
      cell.startsWith('data ksiegowania'),
  );
  const hasAmount = cells.some(
    (cell) => cell === 'kwota' || cell === 'kwota operacji' || cell.startsWith('kwota'),
  );

  return hasDate && hasAmount;
}

/** mBank "Lista operacji" exports include letterhead rows before the real header. */
export function stripMbankMetadata(content: string): string {
  const lines = splitLines(content);
  const headerIndex = lines.findIndex((line) => isTransactionHeaderLine(line));
  if (headerIndex >= 0) {
    return lines.slice(headerIndex).join('\n');
  }
  return content.replace(/^\uFEFF/, '');
}

/** Counterparty account is often appended as 26 digits at the end of #Opis operacji. */
export function extractFromMbankDescription(description: string): {
  senderName: string;
  senderAccount: string;
  title: string;
} {
  const cleaned = description.trim().replace(/^"+|"+$/g, '').trim();
  if (!cleaned) {
    return { senderName: '', senderAccount: '', title: '' };
  }

  const accountMatches = cleaned.match(/\d{26}/g);
  const senderAccount = accountMatches?.[accountMatches.length - 1] ?? '';

  const commaIdx = cleaned.indexOf(',');
  const senderName =
    commaIdx > 0 ? cleaned.slice(0, commaIdx).trim() : cleaned.split(/\s{2,}/)[0]?.trim() ?? '';

  return {
    senderName,
    senderAccount,
    title: cleaned,
  };
}

function parseCurrencyFromAmount(raw: string, currencyCol?: string | null): string {
  if (currencyCol) return currencyCol;
  const match = raw.match(/\b([A-Z]{3})\s*$/);
  return match?.[1] ?? 'PLN';
}

function isIgnorableParseError(message: string): boolean {
  return (
    message.includes('Too few fields') ||
    message.includes('Too many fields') ||
    message.includes('FieldMismatch')
  );
}

function cleanHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim();
}

export interface ParseBankResult {
  transactions: BankTransaction[];
  errors: string[];
  skippedOutgoing: number;
}

export function parseBankCsv(content: string): ParseBankResult {
  const errors: string[] = [];
  const stripped = stripMbankMetadata(content);
  const headerLine = stripped.split(/\r\n|\r|\n/)[0] ?? '';
  const delimiter = detectDelimiter(headerLine);

  const parsed = Papa.parse<Record<string, string>>(stripped, {
    header: true,
    skipEmptyLines: 'greedy',
    delimiter,
    quoteChar: '"',
    transformHeader: cleanHeader,
  });

  const meaningfulErrors = parsed.errors.filter((e) => !isIgnorableParseError(e.message));
  if (meaningfulErrors.length > 0) {
    errors.push(...meaningfulErrors.map((e) => `CSV banku: ${e.message}`));
  }

  const headers = (parsed.meta.fields ?? []).filter((h) => h?.trim());
  const dateCol = findColumn(headers, DATE_ALIASES);
  const accountCol = findCounterpartyAccountColumn(headers);
  const senderCol = findColumn(headers, SENDER_ALIASES);
  const titleCol = findColumn(headers, TITLE_ALIASES);
  const amountCol = findColumn(headers, AMOUNT_ALIASES);
  const currencyCol = findColumn(headers, CURRENCY_ALIASES);
  const descriptionCol = titleCol;
  const useMbankDescription =
    descriptionCol && normalizeHeader(descriptionCol).includes('opis operacji');

  if (!dateCol) errors.push('Nie znaleziono kolumny z datą transakcji.');
  if (!amountCol) errors.push('Nie znaleziono kolumny z kwotą.');
  if (errors.some((e) => e.includes('Nie znaleziono'))) {
    return { transactions: [], errors, skippedOutgoing: 0 };
  }

  const transactions: BankTransaction[] = [];
  let skippedOutgoing = 0;

  parsed.data.forEach((row, index) => {
    const amountRaw = row[amountCol!] ?? '';
    const amount = parseAmount(amountRaw);
    if (!amount) {
      if (amountRaw.trim()) {
        errors.push(`Wiersz ${index + 2}: nieprawidłowa kwota "${amountRaw}"`);
      }
      return;
    }

    if (amount.lte(0)) {
      skippedOutgoing += 1;
      return;
    }

    let senderAccount = accountCol ? (row[accountCol] ?? '').trim() : '';
    let senderName = senderCol ? (row[senderCol] ?? '').trim() : '';
    let title = titleCol ? (row[titleCol] ?? '').trim() : '';

    if (useMbankDescription && descriptionCol) {
      const extracted = extractFromMbankDescription(row[descriptionCol] ?? '');
      if (!senderAccount) senderAccount = extracted.senderAccount;
      if (!senderName) senderName = extracted.senderName;
      if (!title) title = extracted.title;
    }

    const date = dateCol ? (row[dateCol] ?? '').trim() : '';
    const currency = parseCurrencyFromAmount(amountRaw, row[currencyCol ?? '']);

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
