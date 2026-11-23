import React, { useMemo, useState } from 'react';
import {
  CloudUpload,
  ExternalLink,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { MC_CATEGORIES, type ConvertedRecipe, type StoredRecipeRecord } from '../shared/types';
import { api } from '../lib/api';

interface HistoryViewProps {
  recipes: StoredRecipeRecord[];
  loading: boolean;
  onRefresh: () => void;
  onOpenInEditor: (recipe: ConvertedRecipe) => void;
  onGoToConverter: () => void;
  onNotify: (message: string, tone: 'success' | 'info' | 'error') => void;
}

export function HistoryView({
  recipes,
  loading,
  onRefresh,
  onOpenInEditor,
  onGoToConverter,
  onNotify,
}: HistoryViewProps) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [busyId, setBusyId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.sourceUrl || '').toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [recipes, query, categoryFilter]);

  async function handleRetryUpload(record: StoredRecipeRecord) {
    setBusyId(record.id);
    try {
      const res = await api.retryRecipeUpload(record.id);
      onNotify(res.message, res.uploadedToCloud ? 'success' : 'error');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Errore nel caricamento remoto.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(record: StoredRecipeRecord) {
    setBusyId(record.id);
    try {
      await api.deleteRecipe(record.id);
      onNotify(`Ricetta "${record.title}" rimossa dallo storico locale.`, 'info');
      onRefresh();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Errore durante la rimozione.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Storico Ricette e Registro Anti-Duplicati
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Database SQLite locale (<span className="font-mono text-xs">data/recipes.db</span>)
            usato per prevenire importazioni doppie su URL normalizzati e titoli simili (&gt;85%).
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Aggiorna elenco</span>
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <label htmlFor="history-search" className="sr-only">
            Cerca nello storico ricette
          </label>
          <input
            id="history-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca per titolo, URL o categoria..."
            className="w-full h-10 pl-9 pr-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="history-category" className="text-xs font-medium text-slate-600">
            Categoria
          </label>
          <select
            id="history-category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 px-3 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg"
          >
            <option value="all">Tutte ({recipes.length})</option>
            {MC_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Data Table / Empty State */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && recipes.length === 0 ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <UtensilsCrossed className="w-8 h-8 text-slate-300 mx-auto stroke-[1.5]" />
            <h2 className="text-base font-semibold text-slate-900">
              {recipes.length === 0
                ? 'Nessuna ricetta ancora archiviata'
                : 'Nessun risultato per i filtri selezionati'}
            </h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              {recipes.length === 0
                ? 'Converti e approva la tua prima ricetta: verrà salvata in SQLite con hash del titolo e URL normalizzato.'
                : 'Prova a cambiare il testo di ricerca o a selezionare tutte le categorie.'}
            </p>
            {recipes.length === 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onGoToConverter}
                  className="h-10 px-4 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] rounded-lg transition-colors"
                >
                  Importa la prima ricetta
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 pl-5 pr-3">Ricetta</th>
                  <th className="py-3 px-2.5">Scala</th>
                  <th className="py-3 px-2.5">Nutrizione</th>
                  <th className="py-3 px-2.5">Stato Cloud</th>
                  <th className="py-3 pl-2.5 pr-5 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 pl-5 pr-3 max-w-[260px]">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-8 rounded-md overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
                          {rec.coverImageUrl ? (
                            <img
                              src={rec.coverImageUrl}
                              alt={rec.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <UtensilsCrossed className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {rec.title}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="truncate">{rec.category}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums shrink-0">
                              {new Date(rec.createdAt).toLocaleDateString('it-IT')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-2.5 font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                      <div>{rec.appliedMultiplier}x</div>
                      <div className="text-slate-500">
                        {rec.originalServings}→{rec.targetServings} porz.
                      </div>
                    </td>

                    <td className="py-3.5 px-2.5 font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      <div className="text-slate-900 font-medium">{rec.nutrition.kcal} kcal</div>
                      <div className="text-slate-500">
                        P {rec.nutrition.proteine} · C {rec.nutrition.carboidrati} · G{' '}
                        {rec.nutrition.grassi}g
                      </div>
                    </td>

                    <td className="py-3.5 px-2.5 whitespace-nowrap">
                      {rec.uploadStatus === 'synced' ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-[#166534]">Sincronizzata</span>
                          {rec.remoteUrl && (
                            <a
                              href={rec.remoteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 underline"
                            >
                              <span>Apri</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Bozza locale</span>
                      )}
                    </td>

                    <td className="py-3.5 pl-2.5 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {rec.uploadStatus !== 'synced' && (
                          <button
                            type="button"
                            disabled={busyId === rec.id}
                            onClick={() => handleRetryUpload(rec)}
                            aria-label={`Carica su Monsieur Cuisine: ${rec.title}`}
                            className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium text-[#166534] bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors"
                          >
                            <CloudUpload className="w-3.5 h-3.5" />
                            <span>Carica MC</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenInEditor(rec.recipeJson)}
                          aria-label={`Apri in editor: ${rec.title}`}
                          className="h-8 px-2.5 inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Modifica</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === rec.id}
                          onClick={() => handleDelete(rec)}
                          aria-label={`Elimina ricetta: ${rec.title}`}
                          className="h-8 w-8 inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
