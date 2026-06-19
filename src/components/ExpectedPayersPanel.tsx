import { useState } from 'react';
import type { ExpectedPayer } from '../types';
import {
  createEmptyPayer,
  updatePayerAmount,
  updatePayerField,
} from '../lib/expectedPayersStorage';
import { formatMoney } from '../lib/normalize';
import { downloadCsv, exportExpectedPayersCsv } from '../lib/exportCsv';

interface ExpectedPayersPanelProps {
  payers: ExpectedPayer[];
  savedAt: string | null;
  sourceFileName: string;
  onChange: (payers: ExpectedPayer[]) => void;
  onImportCsv: (file: File) => void;
  onClear: () => void;
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pl-PL');
}

export default function ExpectedPayersPanel({
  payers,
  savedAt,
  sourceFileName,
  onChange,
  onImportCsv,
  onClear,
}: ExpectedPayersPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleDelete = (id: string) => {
    if (!confirm('Usunąć tego ucznia z listy?')) return;
    onChange(payers.filter((p) => p.id !== id));
  };

  const handleAdd = () => {
    onChange([...payers, createEmptyPayer()]);
    setExpanded(true);
    setEditing(true);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            Lista uczniów i płatników
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Zapisana lokalnie w przeglądarce — wgraj raz na początku roku, potem tylko
            eksport mBank co miesiąc.
          </p>
          {payers.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">
              {payers.length} uczniów · zapisano: {formatSavedAt(savedAt)}
              {sourceFileName ? ` · ${sourceFileName}` : ''}
            </p>
          )}
        </div>
        {payers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              {expanded ? 'Ukryj listę' : 'Pokaż listę'}
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              {editing ? 'Podgląd' : 'Edytuj ręcznie'}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadCsv(exportExpectedPayersCsv(payers), 'lista-uczniow.csv')
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Eksportuj CSV
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {payers.length === 0 ? 'Wgraj listę CSV' : 'Wgraj CSV (zastąp listę)'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportCsv(file);
              e.target.value = '';
            }}
          />
        </label>
        {payers.length > 0 && (
          <>
            <button
              type="button"
              onClick={handleAdd}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Dodaj ucznia
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Usunąć zapisaną listę uczniów z przeglądarki?')) onClear();
              }}
              className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50"
            >
              Wyczyść listę
            </button>
          </>
        )}
      </div>

      {expanded && payers.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Uczeń</th>
                <th className="px-3 py-2">Rodzic</th>
                <th className="px-3 py-2">Konto</th>
                <th className="px-3 py-2">Kwota</th>
                <th className="px-3 py-2">Grupa</th>
                <th className="px-3 py-2">Notatki</th>
                {editing && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payers.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="w-full min-w-[120px] rounded border border-slate-300 px-2 py-1"
                        value={p.studentName}
                        onChange={(e) =>
                          onChange(updatePayerField(payers, p.id, 'studentName', e.target.value))
                        }
                      />
                    ) : (
                      p.studentName || '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="w-full min-w-[120px] rounded border border-slate-300 px-2 py-1"
                        value={p.parentName}
                        onChange={(e) =>
                          onChange(updatePayerField(payers, p.id, 'parentName', e.target.value))
                        }
                      />
                    ) : (
                      p.parentName || '—'
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {editing ? (
                      <input
                        className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 font-sans"
                        value={p.accountNumber}
                        onChange={(e) =>
                          onChange(updatePayerField(payers, p.id, 'accountNumber', e.target.value))
                        }
                      />
                    ) : (
                      p.accountNumber || '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                        value={p.expectedAmount.toFixed(2)}
                        onChange={(e) =>
                          onChange(updatePayerAmount(payers, p.id, e.target.value))
                        }
                      />
                    ) : (
                      formatMoney(p.expectedAmount)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editing ? (
                      <input
                        className="w-full min-w-[100px] rounded border border-slate-300 px-2 py-1"
                        value={p.lessonGroup}
                        onChange={(e) =>
                          onChange(updatePayerField(payers, p.id, 'lessonGroup', e.target.value))
                        }
                      />
                    ) : (
                      p.lessonGroup || '—'
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    {editing ? (
                      <input
                        className="w-full rounded border border-slate-300 px-2 py-1"
                        value={p.notes}
                        onChange={(e) =>
                          onChange(updatePayerField(payers, p.id, 'notes', e.target.value))
                        }
                      />
                    ) : (
                      p.notes || '—'
                    )}
                  </td>
                  {editing && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(p.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Usuń
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
