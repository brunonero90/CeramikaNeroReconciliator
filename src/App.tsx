import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BankTransaction,
  ExpectedPayer,
  ManualCorrection,
  PaymentStatus,
  ReconciliationResult,
} from './types';
import { parseBankCsv } from './lib/parseBankCsv';
import { parseExpectedCsv } from './lib/parseExpectedCsv';
import { reconcile } from './lib/reconcile';
import { formatMoney } from './lib/normalize';
import {
  assignTransaction,
  ignoreTransaction,
  loadCorrections,
  markPayerPaid,
  saveCorrections,
} from './lib/corrections';
import {
  copyToClipboard,
  downloadCsv,
  exportFullReconciliationCsv,
  exportMissingUnderpaidCsv,
  generateReminderText,
} from './lib/exportCsv';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: 'Opłacone',
  MISSING: 'Brak płatności',
  UNDERPAID: 'Niedopłata',
  OVERPAID: 'Nadpłata',
  AMBIGUOUS: 'Niejednoznaczne',
};

const STATUS_COLORS: Record<PaymentStatus, string> = {
  PAID: 'bg-green-100 text-green-800 border-green-200',
  MISSING: 'bg-red-100 text-red-800 border-red-200',
  UNDERPAID: 'bg-orange-100 text-orange-800 border-orange-200',
  OVERPAID: 'bg-blue-100 text-blue-800 border-blue-200',
  AMBIGUOUS: 'bg-orange-100 text-orange-800 border-orange-200',
};

function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'UTF-8');
  });
}

export default function App() {
  const [payers, setPayers] = useState<ExpectedPayer[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [corrections, setCorrections] = useState<ManualCorrection>(loadCorrections);
  const [errors, setErrors] = useState<string[]>([]);
  const [monthLabel, setMonthLabel] = useState('');
  const [bankFileName, setBankFileName] = useState('');
  const [expectedFileName, setExpectedFileName] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentStatus | 'ALL'>('ALL');

  useEffect(() => {
    saveCorrections(corrections);
  }, [corrections]);

  const result: ReconciliationResult | null = useMemo(() => {
    if (payers.length === 0) return null;
    return reconcile(payers, transactions, corrections);
  }, [payers, transactions, corrections]);

  const handleExpectedUpload = useCallback(async (file: File) => {
    const content = await readFileAsText(file);
    const parsed = parseExpectedCsv(content);
    setExpectedFileName(file.name);
    setPayers(parsed.payers);
    setErrors((prev) => [
      ...prev.filter((e) => !e.startsWith('Oczekiwane')),
      ...parsed.errors.map((e) => `Oczekiwane: ${e}`),
    ]);
  }, []);

  const handleBankUpload = useCallback(async (file: File) => {
    const content = await readFileAsText(file);
    const parsed = parseBankCsv(content);
    setBankFileName(file.name);
    setTransactions(parsed.transactions);
    const msgs = parsed.errors.map((e) => `Bank: ${e}`);
    if (parsed.skippedOutgoing > 0) {
      msgs.push(
        `Bank: Pominięto ${parsed.skippedOutgoing} transakcji wychodzących/zwrotów.`,
      );
    }
    setErrors((prev) => [
      ...prev.filter((e) => !e.startsWith('Bank:')),
      ...msgs,
    ]);
  }, []);

  const loadSamples = useCallback(async () => {
    const [expectedRes, bankRes] = await Promise.all([
      fetch('/samples/expected_payments.csv'),
      fetch('/samples/mbank_export.csv'),
    ]);
    const expectedContent = await expectedRes.text();
    const bankContent = await bankRes.text();

    const expectedParsed = parseExpectedCsv(expectedContent);
    const bankParsed = parseBankCsv(bankContent);

    setPayers(expectedParsed.payers);
    setTransactions(bankParsed.transactions);
    setExpectedFileName('expected_payments.csv (przykład)');
    setBankFileName('mbank_export.csv (przykład)');
    setMonthLabel('czerwiec 2025');
    setErrors([]);
  }, []);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    if (filter === 'ALL') return result.rows;
    return result.rows.filter((r) => r.status === filter);
  }, [result, filter]);

  const handleAssign = (transactionId: string, payerId: string) => {
    setCorrections((c) => assignTransaction(c, transactionId, payerId));
  };

  const handleIgnore = (transactionId: string) => {
    setCorrections((c) => ignoreTransaction(c, transactionId));
  };

  const handleMarkPaid = (payerId: string) => {
    setCorrections((c) => markPayerPaid(c, payerId, undefined, 'Oznaczono ręcznie'));
  };

  const handleCopyReminder = async (payerId: string) => {
    const row = result?.rows.find((r) => r.payer.id === payerId);
    if (!row) return;
    const text = generateReminderText(row, monthLabel || undefined);
    await copyToClipboard(text);
    setCopyFeedback(payerId);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Ceramika Nero — Rozliczenie płatności
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Miesięczne rozliczenie opłat za zajęcia ceramiczne
          </p>
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            Pliki są analizowane lokalnie w przeglądarce. Dane nie są wysyłane na
            serwer.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-slate-800">
            Wgraj pliki
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Lista oczekiwanych płatności (CSV)
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleExpectedUpload(file);
                }}
              />
              {expectedFileName && (
                <p className="mt-1 text-xs text-slate-500">{expectedFileName}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Eksport mBank (CSV)
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleBankUpload(file);
                }}
              />
              {bankFileName && (
                <p className="mt-1 text-xs text-slate-500">{bankFileName}</p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadSamples()}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Wczytaj przykładowe pliki
            </button>
            <div>
              <label className="mr-2 text-sm text-slate-600">Miesiąc:</label>
              <input
                type="text"
                placeholder="np. czerwiec 2025"
                value={monthLabel}
                onChange={(e) => setMonthLabel(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-medium text-amber-900">Uwagi</h3>
            <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </section>
        )}

        {result && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Oczekiwane', value: formatMoney(result.summary.totalExpected), color: 'text-slate-800' },
                { label: 'Otrzymane', value: formatMoney(result.summary.totalReceived), color: 'text-green-700' },
                { label: 'Brakujące', value: formatMoney(result.summary.totalMissing), color: 'text-red-700' },
                { label: 'Opłacone', value: String(result.summary.paidCount), color: 'text-green-700' },
                { label: 'Brak płatności', value: String(result.summary.missingCount), color: 'text-red-700' },
                { label: 'Niedopłaty', value: String(result.summary.underpaidCount), color: 'text-orange-700' },
                { label: 'Nadpłaty', value: String(result.summary.overpaidCount), color: 'text-blue-700' },
                { label: 'Nieznane przelewy', value: String(result.summary.unknownCount), color: 'text-orange-700' },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {card.label}
                  </p>
                  <p className={`mt-1 text-2xl font-bold ${card.color}`}>
                    {card.value}
                  </p>
                </div>
              ))}
            </section>

            <section className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    exportFullReconciliationCsv(result.rows),
                    `rozliczenie-${monthLabel || 'export'}.csv`,
                  )
                }
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Eksportuj pełne rozliczenie (CSV)
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    exportMissingUnderpaidCsv(result.rows),
                    `braki-${monthLabel || 'export'}.csv`,
                  )
                }
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Eksportuj braki i niedopłaty (CSV)
              </button>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <h2 className="text-lg font-semibold text-slate-800">
                  Rozliczenie uczniów
                </h2>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as PaymentStatus | 'ALL')}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="ALL">Wszystkie</option>
                  <option value="PAID">Opłacone</option>
                  <option value="MISSING">Brak płatności</option>
                  <option value="UNDERPAID">Niedopłaty</option>
                  <option value="OVERPAID">Nadpłaty</option>
                  <option value="AMBIGUOUS">Niejednoznaczne</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Uczeń</th>
                      <th className="px-4 py-3">Rodzic</th>
                      <th className="px-4 py-3">Oczekiwana</th>
                      <th className="px-4 py-3">Wpłacona</th>
                      <th className="px-4 py-3">Różnica</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Pewność</th>
                      <th className="px-4 py-3">Przelewy</th>
                      <th className="px-4 py-3">Akcje</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map((row) => (
                      <tr key={row.payer.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium">{row.payer.studentName}</td>
                        <td className="px-4 py-3">{row.payer.parentName}</td>
                        <td className="px-4 py-3">{formatMoney(row.expectedAmount)}</td>
                        <td className="px-4 py-3">{formatMoney(row.paidAmount)}</td>
                        <td className="px-4 py-3">{formatMoney(row.difference)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-4 py-3">
                          {row.confidence > 0
                            ? `${Math.round(row.confidence * 100)}%`
                            : '—'}
                        </td>
                        <td className="max-w-xs px-4 py-3">
                          {row.matchedTransactions.length === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <ul className="space-y-1 text-xs text-slate-600">
                              {row.matchedTransactions.map((m) => (
                                <li key={m.transaction.id}>
                                  {m.transaction.date}: {formatMoney(m.allocatedAmount)}
                                  {!m.allocatedAmount.equals(m.transaction.amount) && (
                                    <span className="text-slate-400">
                                      {' '}
                                      (z {formatMoney(m.transaction.amount)})
                                    </span>
                                  )}{' '}
                                  <span className="text-slate-400">({m.reason})</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {row.notes && (
                            <p className="mt-1 text-xs text-slate-500">{row.notes}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {(row.status === 'MISSING' || row.status === 'UNDERPAID') && (
                              <button
                                type="button"
                                onClick={() => void handleCopyReminder(row.payer.id)}
                                className="text-left text-xs text-blue-600 hover:underline"
                              >
                                {copyFeedback === row.payer.id
                                  ? 'Skopiowano!'
                                  : 'Kopiuj przypomnienie SMS'}
                              </button>
                            )}
                            {row.status !== 'PAID' && (
                              <button
                                type="button"
                                onClick={() => handleMarkPaid(row.payer.id)}
                                className="text-left text-xs text-slate-600 hover:underline"
                              >
                                Oznacz jako opłacone
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {result.unknownPayments.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h2 className="text-lg font-semibold text-slate-800">
                    Nieznane przelewy ({result.unknownPayments.length})
                  </h2>
                  <p className="text-sm text-slate-500">
                    Przelewy, których nie udało się automatycznie przypisać
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Nadawca</th>
                        <th className="px-4 py-3">Konto</th>
                        <th className="px-4 py-3">Tytuł</th>
                        <th className="px-4 py-3">Kwota</th>
                        <th className="px-4 py-3">Możliwe dopasowania</th>
                        <th className="px-4 py-3">Akcja</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.unknownPayments.map(({ transaction, possibleMatches }) => (
                        <tr key={transaction.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">{transaction.date}</td>
                          <td className="px-4 py-3">{transaction.senderName}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {transaction.senderAccount || '—'}
                          </td>
                          <td className="max-w-xs px-4 py-3">{transaction.title}</td>
                          <td className="px-4 py-3 font-medium">
                            {formatMoney(transaction.amount)}
                          </td>
                          <td className="px-4 py-3">
                            {possibleMatches.length === 0 ? (
                              <span className="text-slate-400">Brak</span>
                            ) : (
                              <ul className="space-y-1 text-xs">
                                {possibleMatches.map((m) => (
                                  <li key={m.payerId}>
                                    {m.studentName} ({m.parentName}) —{' '}
                                    {Math.round(m.confidence * 100)}%
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-2">
                              <select
                                className="rounded border border-slate-300 px-2 py-1 text-xs"
                                defaultValue=""
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleAssign(transaction.id, e.target.value);
                                    e.target.value = '';
                                  }
                                }}
                              >
                                <option value="">Przypisz do ucznia…</option>
                                {payers.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.studentName} ({p.parentName})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleIgnore(transaction.id)}
                                className="text-left text-xs text-slate-500 hover:underline"
                              >
                                Ignoruj
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        {payers.length === 0 && (
          <section className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="text-slate-600">
              Wgraj pliki CSV lub wczytaj przykładowe dane, aby rozpocząć rozliczenie.
            </p>
          </section>
        )}
      </main>

      <footer className="mt-8 border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        Ceramika Nero Reconciliator — przetwarzanie lokalne, bez serwera
      </footer>
    </div>
  );
}
