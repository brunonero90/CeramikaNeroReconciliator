import type Decimal from 'decimal.js';

export type PaymentStatus =
  | 'PAID'
  | 'MISSING'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'AMBIGUOUS';

export interface ExpectedPayer {
  id: string;
  studentName: string;
  parentName: string;
  accountNumber: string;
  normalizedAccount: string;
  expectedAmount: Decimal;
  lessonGroup: string;
  notes: string;
}

export interface BankTransaction {
  id: string;
  date: string;
  senderAccount: string;
  normalizedAccount: string;
  senderName: string;
  title: string;
  amount: Decimal;
  currency: string;
  rawIndex: number;
}

export interface PossibleMatch {
  payerId: string;
  studentName: string;
  parentName: string;
  confidence: number;
  reason: string;
}

export interface MatchResult {
  transactionId: string;
  payerId: string | null;
  confidence: number;
  reason: string;
  isAmbiguous: boolean;
  possibleMatches: PossibleMatch[];
}

export interface MatchedTransaction {
  transaction: BankTransaction;
  confidence: number;
  reason: string;
  allocatedAmount: Decimal;
}

export interface ReconciliationRow {
  payer: ExpectedPayer;
  expectedAmount: Decimal;
  paidAmount: Decimal;
  difference: Decimal;
  status: PaymentStatus;
  matchedTransactions: MatchedTransaction[];
  confidence: number;
  notes: string;
  possibleMatches: PossibleMatch[];
}

export interface UnknownPayment {
  transaction: BankTransaction;
  possibleMatches: PossibleMatch[];
}

export interface DashboardSummary {
  totalExpected: Decimal;
  totalReceived: Decimal;
  totalMissing: Decimal;
  paidCount: number;
  missingCount: number;
  underpaidCount: number;
  overpaidCount: number;
  ambiguousCount: number;
  unknownCount: number;
}

export interface ManualCorrection {
  assignedTransactions: Record<string, string>;
  ignoredTransactions: string[];
  manuallyPaidPayers: Record<string, { amount?: string; note?: string }>;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  unknownPayments: UnknownPayment[];
  summary: DashboardSummary;
  duplicateTransactionIds: string[];
}

export const EMPTY_CORRECTIONS: ManualCorrection = {
  assignedTransactions: {},
  ignoredTransactions: [],
  manuallyPaidPayers: {},
};

export const CORRECTIONS_STORAGE_KEY = 'ceramika-reconciliator-corrections';
