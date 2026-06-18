import Decimal from 'decimal.js';
import type {
  BankTransaction,
  ExpectedPayer,
  ManualCorrection,
  MatchResult,
  PossibleMatch,
  ReconciliationResult,
  ReconciliationRow,
  UnknownPayment,
} from '../types';
import { accountsMatch } from './normalize';
import { combinedNameScore } from './fuzzyMatch';

const STRONG_ACCOUNT_CONFIDENCE = 0.95;
const NAME_MATCH_THRESHOLD = 0.55;
const AMBIGUOUS_GAP = 0.12;

interface TransactionAssignment {
  transaction: BankTransaction;
  payerId: string;
  confidence: number;
  reason: string;
  allocatedAmount: Decimal;
}

function payerToPossibleMatch(
  payer: ExpectedPayer,
  confidence: number,
  reason: string,
): PossibleMatch {
  return {
    payerId: payer.id,
    studentName: payer.studentName,
    parentName: payer.parentName,
    confidence,
    reason,
  };
}

function findAccountMatches(
  transaction: BankTransaction,
  payers: ExpectedPayer[],
): PossibleMatch[] {
  if (!transaction.normalizedAccount) return [];

  return payers
    .filter((p) => p.normalizedAccount && accountsMatch(p.normalizedAccount, transaction.normalizedAccount))
    .map((p) =>
      payerToPossibleMatch(p, STRONG_ACCOUNT_CONFIDENCE, 'Dopasowanie po numerze konta'),
    );
}

function findNameMatches(
  transaction: BankTransaction,
  payers: ExpectedPayer[],
): PossibleMatch[] {
  const matches: PossibleMatch[] = [];

  for (const payer of payers) {
    const score = combinedNameScore(
      payer.parentName,
      payer.studentName,
      transaction.senderName,
      transaction.title,
    );
    if (score >= NAME_MATCH_THRESHOLD) {
      matches.push(
        payerToPossibleMatch(
          payer,
          score,
          score >= 0.85
            ? 'Dopasowanie po nazwie rodzica/ucznia'
            : 'Częściowe dopasowanie nazwy',
        ),
      );
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

function findAmountMatches(
  transaction: BankTransaction,
  payers: ExpectedPayer[],
): PossibleMatch[] {
  const amountMatches = payers.filter((p) =>
    p.expectedAmount.equals(transaction.amount),
  );

  if (amountMatches.length === 1) {
    const payer = amountMatches[0];
    const nameBoost = combinedNameScore(
      payer.parentName,
      payer.studentName,
      transaction.senderName,
      transaction.title,
    );
    const confidence = nameBoost > 0.3 ? 0.75 + nameBoost * 0.2 : 0.55;
    return [
      payerToPossibleMatch(
        payer,
        Math.min(confidence, 0.9),
        'Unikalna kwota + podobny tytuł/nadawca',
      ),
    ];
  }

  if (amountMatches.length > 1) {
    return amountMatches
      .map((p) => {
        const nameScore = combinedNameScore(
          p.parentName,
          p.studentName,
          transaction.senderName,
          transaction.title,
        );
        return payerToPossibleMatch(
          p,
          0.4 + nameScore * 0.4,
          'Ta sama kwota u wielu uczniów',
        );
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  return [];
}

function findCandidates(
  transaction: BankTransaction,
  payers: ExpectedPayer[],
): PossibleMatch[] {
  const accountMatches = findAccountMatches(transaction, payers);
  if (accountMatches.length === 1) {
    return accountMatches;
  }

  if (accountMatches.length > 1) {
    const withNames = accountMatches.map((m) => {
      const payer = payers.find((p) => p.id === m.payerId)!;
      const nameScore = combinedNameScore(
        payer.parentName,
        payer.studentName,
        transaction.senderName,
        transaction.title,
      );
      return {
        ...m,
        confidence: Math.min(0.98, m.confidence + nameScore * 0.15),
        reason:
          nameScore > 0.5
            ? 'Wspólne konto rodzeństwa + nazwa w tytule'
            : 'Wspólne konto rodzeństwa',
      };
    });
    return withNames.sort((a, b) => b.confidence - a.confidence);
  }

  const nameMatches = findNameMatches(transaction, payers);
  if (nameMatches.length > 0 && nameMatches[0].confidence >= 0.7) {
    return nameMatches;
  }

  const amountMatches = findAmountMatches(transaction, payers);
  if (amountMatches.length > 1) {
    const top = amountMatches[0].confidence;
    const second = amountMatches[1]?.confidence ?? 0;
    if (top < STRONG_ACCOUNT_CONFIDENCE && top - second < AMBIGUOUS_GAP) {
      return amountMatches;
    }
  }

  const combined = [...nameMatches, ...amountMatches];
  const byPayer = new Map<string, PossibleMatch>();

  for (const match of combined) {
    const existing = byPayer.get(match.payerId);
    if (!existing || match.confidence > existing.confidence) {
      byPayer.set(match.payerId, match);
    }
  }

  return [...byPayer.values()].sort((a, b) => b.confidence - a.confidence);
}

function isAmbiguous(candidates: PossibleMatch[]): boolean {
  if (candidates.length < 2) return false;
  const top = candidates[0].confidence;
  const second = candidates[1].confidence;
  return top - second < AMBIGUOUS_GAP && top < STRONG_ACCOUNT_CONFIDENCE;
}

function matchTransaction(
  transaction: BankTransaction,
  payers: ExpectedPayer[],
): MatchResult {
  const candidates = findCandidates(transaction, payers);

  if (candidates.length === 0) {
    return {
      transactionId: transaction.id,
      payerId: null,
      confidence: 0,
      reason: 'Brak dopasowania',
      isAmbiguous: false,
      possibleMatches: [],
    };
  }

  const ambiguous = isAmbiguous(candidates);
  const best = candidates[0];

  if (ambiguous && best.confidence < STRONG_ACCOUNT_CONFIDENCE) {
    return {
      transactionId: transaction.id,
      payerId: null,
      confidence: best.confidence,
      reason: 'Niejednoznaczne dopasowanie',
      isAmbiguous: true,
      possibleMatches: candidates.slice(0, 5),
    };
  }

  return {
    transactionId: transaction.id,
    payerId: best.payerId,
    confidence: best.confidence,
    reason: best.reason,
    isAmbiguous: false,
    possibleMatches: candidates.slice(0, 5),
  };
}

function detectDuplicates(transactions: BankTransaction[]): string[] {
  const seen = new Map<string, string[]>();

  for (const tx of transactions) {
    const key = [
      tx.date,
      tx.normalizedAccount,
      tx.amount.toFixed(2),
      tx.title.toLowerCase().trim(),
    ].join('|');
    const ids = seen.get(key) ?? [];
    ids.push(tx.id);
    seen.set(key, ids);
  }

  const duplicates: string[] = [];
  for (const ids of seen.values()) {
    if (ids.length > 1) {
      duplicates.push(...ids.slice(1));
    }
  }
  return duplicates;
}

function assign(
  transaction: BankTransaction,
  payerId: string,
  confidence: number,
  reason: string,
  allocatedAmount?: Decimal,
): TransactionAssignment {
  return {
    transaction,
    payerId,
    confidence,
    reason,
    allocatedAmount: allocatedAmount ?? transaction.amount,
  };
}

function trySplitCombinedPayment(
  transaction: BankTransaction,
  accountPayers: ExpectedPayer[],
): TransactionAssignment[] | null {
  if (accountPayers.length < 2) return null;

  const totalExpected = accountPayers.reduce(
    (sum, p) => sum.plus(p.expectedAmount),
    new Decimal(0),
  );

  if (transaction.amount.equals(totalExpected)) {
    return accountPayers.map((p) =>
      assign(
        transaction,
        p.id,
        0.9,
        'Jeden przelew za wielu uczniów z tego konta',
        p.expectedAmount,
      ),
    );
  }

  const exactChild = accountPayers.find((p) =>
    transaction.amount.equals(p.expectedAmount),
  );
  if (exactChild) {
    const nameScore = combinedNameScore(
      exactChild.parentName,
      exactChild.studentName,
      transaction.senderName,
      transaction.title,
    );
    if (nameScore > 0.3 || accountPayers.length === 2) {
      return [
        assign(
          transaction,
          exactChild.id,
          0.85 + nameScore * 0.1,
          'Kwota jednego ucznia z wspólnego konta',
        ),
      ];
    }
  }

  return null;
}

export function reconcile(
  payers: ExpectedPayer[],
  transactions: BankTransaction[],
  corrections: ManualCorrection = {
    assignedTransactions: {},
    ignoredTransactions: [],
    manuallyPaidPayers: {},
  },
): ReconciliationResult {
  const duplicateTransactionIds = detectDuplicates(transactions);
  const ignoredSet = new Set(corrections.ignoredTransactions);

  const activeTransactions = transactions.filter((t) => !ignoredSet.has(t.id));

  const assignments: TransactionAssignment[] = [];
  const unknownTransactions: BankTransaction[] = [];
  const ambiguousByPayer = new Map<string, PossibleMatch[]>();

  const assignedByManual = new Set<string>();

  for (const tx of activeTransactions) {
    const manualPayerId = corrections.assignedTransactions[tx.id];
    if (manualPayerId) {
      assignments.push(assign(tx, manualPayerId, 1, 'Przypisanie ręczne'));
      assignedByManual.add(tx.id);
    }
  }

  const unassigned = activeTransactions.filter(
    (t) => !assignedByManual.has(t.id),
  );

  const byAccount = new Map<string, BankTransaction[]>();
  for (const tx of unassigned) {
    if (!tx.normalizedAccount) continue;
    const list = byAccount.get(tx.normalizedAccount) ?? [];
    list.push(tx);
    byAccount.set(tx.normalizedAccount, list);
  }

  const processedTxIds = new Set<string>();

  for (const [, accountTxs] of byAccount) {
    const accountPayers = payers.filter((p) =>
      p.normalizedAccount &&
      accountsMatch(p.normalizedAccount, accountTxs[0].normalizedAccount),
    );

    if (accountPayers.length === 1) {
      for (const tx of accountTxs) {
        assignments.push(
          assign(tx, accountPayers[0].id, STRONG_ACCOUNT_CONFIDENCE, 'Dopasowanie po numerze konta'),
        );
        processedTxIds.add(tx.id);
      }
      continue;
    }

    if (accountPayers.length > 1) {
      const totalPaid = accountTxs.reduce(
        (sum, t) => sum.plus(t.amount),
        new Decimal(0),
      );
      const totalExpected = accountPayers.reduce(
        (sum, p) => sum.plus(p.expectedAmount),
        new Decimal(0),
      );

      if (accountTxs.length === 1 && totalPaid.equals(totalExpected)) {
        for (const p of accountPayers) {
          assignments.push(
            assign(
              accountTxs[0],
              p.id,
              0.92,
              'Jeden przelew za rodzeństwo',
              p.expectedAmount,
            ),
          );
        }
        processedTxIds.add(accountTxs[0].id);
        continue;
      }

      for (const tx of accountTxs) {
        const split = trySplitCombinedPayment(tx, accountPayers);
        if (split) {
          assignments.push(...split);
          processedTxIds.add(tx.id);
        }
      }
    }
  }

  for (const tx of unassigned) {
    if (processedTxIds.has(tx.id)) continue;

    const result = matchTransaction(tx, payers);

    if (result.payerId && !result.isAmbiguous) {
      assignments.push(
        assign(tx, result.payerId, result.confidence, result.reason),
      );
    } else if (result.isAmbiguous) {
      for (const match of result.possibleMatches) {
        const list = ambiguousByPayer.get(match.payerId) ?? [];
        list.push(match);
        ambiguousByPayer.set(match.payerId, list);
      }
      unknownTransactions.push(tx);
    } else {
      unknownTransactions.push(tx);
    }
  }

  const payerAssignments = new Map<string, TransactionAssignment[]>();
  for (const a of assignments) {
    const list = payerAssignments.get(a.payerId) ?? [];
    list.push(a);
    payerAssignments.set(a.payerId, list);
  }

  const rows: ReconciliationRow[] = payers.map((payer) => {
    const payerTxs = payerAssignments.get(payer.id) ?? [];
    const paidAmount = payerTxs.reduce(
      (sum, a) => sum.plus(a.allocatedAmount),
      new Decimal(0),
    );

    const manual = corrections.manuallyPaidPayers[payer.id];
    let finalPaid = paidAmount;
    let notes = payer.notes;
    let confidence =
      payerTxs.length > 0
        ? payerTxs.reduce((max, a) => Math.max(max, a.confidence), 0)
        : 0;

    if (manual) {
      if (manual.amount) {
        finalPaid = new Decimal(manual.amount);
      } else if (finalPaid.isZero()) {
        finalPaid = payer.expectedAmount;
      }
      confidence = 1;
      notes = [notes, manual.note ?? 'Oznaczono ręcznie jako opłacone']
        .filter(Boolean)
        .join('; ');
    }

    const difference = finalPaid.minus(payer.expectedAmount);
    let status: ReconciliationRow['status'] = 'MISSING';

    if (finalPaid.isZero()) {
      status = ambiguousByPayer.has(payer.id) ? 'AMBIGUOUS' : 'MISSING';
    } else if (difference.abs().lte(new Decimal('0.01'))) {
      status = 'PAID';
    } else if (difference.lt(0)) {
      status = 'UNDERPAID';
    } else {
      status = 'OVERPAID';
    }

  if (payerTxs.length > 1) {
      notes = [notes, `Wiele przelewów (${payerTxs.length})`]
        .filter(Boolean)
        .join('; ');
    }

    if (duplicateTransactionIds.some((id) => payerTxs.some((a) => a.transaction.id === id))) {
      notes = [notes, 'Możliwy duplikat przelewu'].filter(Boolean).join('; ');
    }

    return {
      payer,
      expectedAmount: payer.expectedAmount,
      paidAmount: finalPaid,
      difference,
      status,
      matchedTransactions: payerTxs.map((a) => ({
        transaction: a.transaction,
        confidence: a.confidence,
        reason: a.reason,
        allocatedAmount: a.allocatedAmount,
      })),
      confidence,
      notes,
      possibleMatches: ambiguousByPayer.get(payer.id) ?? [],
    };
  });

  const assignedIds = new Set(assignments.map((a) => a.transaction.id));
  const unknownPayments: UnknownPayment[] = unknownTransactions
    .filter((t) => !assignedIds.has(t.id))
    .map((t) => ({
      transaction: t,
      possibleMatches: findCandidates(t, payers).slice(0, 5),
    }));

  const totalExpected = payers.reduce(
    (sum, p) => sum.plus(p.expectedAmount),
    new Decimal(0),
  );
  const totalReceived = rows.reduce(
    (sum, r) => sum.plus(r.paidAmount),
    new Decimal(0),
  );
  const totalMissing = rows
    .filter((r) => r.status === 'MISSING' || r.status === 'UNDERPAID')
    .reduce((sum, r) => {
      if (r.status === 'MISSING') return sum.plus(r.expectedAmount);
      return sum.plus(r.difference.abs());
    }, new Decimal(0));

  const summary = {
    totalExpected,
    totalReceived,
    totalMissing,
    paidCount: rows.filter((r) => r.status === 'PAID').length,
    missingCount: rows.filter((r) => r.status === 'MISSING').length,
    underpaidCount: rows.filter((r) => r.status === 'UNDERPAID').length,
    overpaidCount: rows.filter((r) => r.status === 'OVERPAID').length,
    ambiguousCount: rows.filter((r) => r.status === 'AMBIGUOUS').length,
    unknownCount: unknownPayments.length,
  };

  return {
    rows,
    unknownPayments,
    summary,
    duplicateTransactionIds,
  };
}
