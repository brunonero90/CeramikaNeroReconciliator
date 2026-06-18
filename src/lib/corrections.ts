import type { ManualCorrection } from '../types';
import { CORRECTIONS_STORAGE_KEY, EMPTY_CORRECTIONS } from '../types';

export function loadCorrections(): ManualCorrection {
  try {
    const raw = localStorage.getItem(CORRECTIONS_STORAGE_KEY);
    if (!raw) return { ...EMPTY_CORRECTIONS };
    const parsed = JSON.parse(raw) as ManualCorrection;
    return {
      assignedTransactions: parsed.assignedTransactions ?? {},
      ignoredTransactions: parsed.ignoredTransactions ?? [],
      manuallyPaidPayers: parsed.manuallyPaidPayers ?? {},
    };
  } catch {
    return { ...EMPTY_CORRECTIONS };
  }
}

export function saveCorrections(corrections: ManualCorrection): void {
  localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(corrections));
}

export function assignTransaction(
  corrections: ManualCorrection,
  transactionId: string,
  payerId: string,
): ManualCorrection {
  const ignoredTransactions = corrections.ignoredTransactions.filter(
    (id) => id !== transactionId,
  );
  return {
    ...corrections,
    ignoredTransactions,
    assignedTransactions: {
      ...corrections.assignedTransactions,
      [transactionId]: payerId,
    },
  };
}

export function ignoreTransaction(
  corrections: ManualCorrection,
  transactionId: string,
): ManualCorrection {
  const { [transactionId]: _removed, ...assignedTransactions } =
    corrections.assignedTransactions;
  return {
    ...corrections,
    assignedTransactions,
    ignoredTransactions: [...corrections.ignoredTransactions, transactionId],
  };
}

export function markPayerPaid(
  corrections: ManualCorrection,
  payerId: string,
  amount?: string,
  note?: string,
): ManualCorrection {
  return {
    ...corrections,
    manuallyPaidPayers: {
      ...corrections.manuallyPaidPayers,
      [payerId]: { amount, note },
    },
  };
}

export function clearCorrections(): void {
  localStorage.removeItem(CORRECTIONS_STORAGE_KEY);
}
