import Decimal from 'decimal.js';

const POLISH_ACCENTS: Record<string, string> = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
  Ą: 'a',
  Ć: 'c',
  Ę: 'e',
  Ł: 'l',
  Ń: 'n',
  Ó: 'o',
  Ś: 's',
  Ź: 'z',
  Ż: 'z',
};

export function removePolishAccents(text: string): string {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => POLISH_ACCENTS[ch] ?? ch);
}

export function normalizeName(name: string): string {
  return removePolishAccents(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeAccountNumber(account: string): string {
  if (!account) return '';
  let cleaned = account.trim().toUpperCase();
  if (cleaned.startsWith('PL')) {
    cleaned = cleaned.slice(2);
  }
  cleaned = cleaned.replace(/[\s\-]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length >= 26) {
    return digits.slice(-26);
  }
  return digits;
}

export function accountsMatch(a: string, b: string): boolean {
  const na = normalizeAccountNumber(a);
  const nb = normalizeAccountNumber(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 10) {
    return na.slice(-minLen) === nb.slice(-minLen);
  }
  return false;
}

export function parseAmount(value: string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Decimal(value);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  let normalized = trimmed.replace(/\s/g, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = normalized.replace(',', '.');
  }

  normalized = normalized.replace(/[^\d.\-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return null;

  try {
    return new Decimal(normalized);
  } catch {
    return null;
  }
}

export function formatMoney(amount: Decimal): string {
  return amount.toFixed(2).replace('.', ',');
}

export function formatMoneyPlain(amount: Decimal): string {
  return amount.toFixed(2);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeHeader(header: string): string {
  return removePolishAccents(header)
    .toLowerCase()
    .trim()
    .replace(/[#"'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, '');
}

export function repairMbankEncoding(text: string): string {
  return text
    .replace(/ê/g, 'e')
    .replace(/Ê/g, 'E')
    .replace(/¹/g, 'a')
    .replace(/³/g, 'l')
    .replace(/£/g, 'L')
    .replace(/Ÿ/g, 'z')
    .replace(/¿/g, 'z')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/¥/g, 'y')
    .replace(/ô/g, 'o')
    .replace(/Ó/g, 'O')
    .replace(/ó/g, 'o')
    .replace(/ê/g, 'e');
}

export function normalizeBankHeader(header: string): string {
  return normalizeHeader(repairMbankEncoding(header));
}

export function formatAccountDisplay(account: string): string {
  const digits = account.replace(/\D/g, '').slice(-26);
  if (digits.length < 26) return account.trim();
  return [
    digits.slice(0, 2),
    digits.slice(2, 6),
    digits.slice(6, 10),
    digits.slice(10, 14),
    digits.slice(14, 18),
    digits.slice(18, 22),
    digits.slice(22, 26),
  ].join(' ');
}

export function cleanBankField(value: string): string {
  return value.trim().replace(/^['"]+|['"]+$/g, '').trim();
}
