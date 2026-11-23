import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileText, Globe, Loader2, Sparkles } from 'lucide-react';
import type { ConvertedRecipe, DuplicateCheckResult } from '../shared/types';
import { api, ApiError } from '../lib/api';
import { SAMPLE_RECIPES, type SampleRecipeTemplate } from '../lib/sampleRecipes';
import { RecipeReviewPanel } from './RecipeReviewPanel';

interface ConverterViewProps {
  defaultMultiplier: number;
  initialReviewRecipe?: ConvertedRecipe | null;
  onClearInitialReview?: () => void;
  onRecipeSaved: (message: string, uploadedToCloud: boolean) => void;
}

export function ConverterView({
  defaultMultiplier,
  initialReviewRecipe,
  onClearInitialReview,
  onRecipeSaved,
}: ConverterViewProps) {
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [sampleCoverUrl, setSampleCoverUrl] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<number>(defaultMultiplier);
  const [forceReimport, setForceReimport] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedDuplicate, setBlockedDuplicate] = useState<DuplicateCheckResult | null>(null);

  const [reviewState, setReviewState] = useState<{
    recipe: ConvertedRecipe;
    duplicateCheck: DuplicateCheckResult;
  } | null>(null);

  useEffect(() => {
    setMultiplier(defaultMultiplier);
  }, [defaultMultiplier]);

  useEffect(() => {
    if (initialReviewRecipe) {
      setReviewState({
        recipe: initialReviewRecipe,
        duplicateCheck: { hasDuplicate: false, matches: [], remoteChecked: false },
      });
    }
  }, [initialReviewRecipe]);

  function loadSample(sample: SampleRecipeTemplate) {
    setMode('text');
    setTextInput(sample.rawText);
    setUrlInput('');
    setSampleCoverUrl(sample.coverImageUrl);
    setError(null);
    setBlockedDuplicate(null);
  }

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBlockedDuplicate(null);

    if (mode === 'url' && !urlInput.trim()) {
      setError('Inserisci l’URL della ricetta da convertire.');
      return;
    }
    if (mode === 'text' && textInput.trim().length < 20) {
      setError('Incolla il testo completo della ricetta (titolo, ingredienti e passaggi).');
      return;
    }

    setConverting(true);
    try {
      const result = await api.convertRecipe({
        mode,
        url: mode === 'url' ? urlInput.trim() : undefined,
        text: mode === 'text' ? textInput.trim() : undefined,
        multiplier,
        forceReimport,
        coverImageUrl: mode === 'text' ? sampleCoverUrl : null,
      });
      setReviewState({
        recipe: result.recipe,
        duplicateCheck: result.duplicateCheck,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.duplicateCheck) {
        setBlockedDuplicate(err.data.duplicateCheck as DuplicateCheckResult);
      }
      setError(err instanceof Error ? err.message : 'Errore durante la conversione.');
    } finally {
      setConverting(false);
    }
  }

  if (reviewState) {
    return (
      <RecipeReviewPanel
        initialRecipe={reviewState.recipe}
        initialDuplicateCheck={reviewState.duplicateCheck}
        onBack={() => {
          setReviewState(null);
          onClearInitialReview?.();
        }}
        onUploaded={(msg, uploadedToCloud) => {
          setReviewState(null);
          onClearInitialReview?.();
          onRecipeSaved(msg, uploadedToCloud);
        }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          Importa e converti una ricetta per Monsieur Cuisine Smart
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Incolla un link (GialloZafferano, Ricettario Bimby, ZauberMix, blog di cucina) o il testo
          libero. Il motore AI applica il riproporzionamento intelligente, verifica la capienza del
          boccale da 3 L e sostituisce la Velocità 1 continua con i programmi automatici nativi.
        </p>
      </div>

      {/* Main Converter Form */}
      <form
        onSubmit={handleConvert}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div
            role="tablist"
            aria-label="Sorgente ricetta"
            className="inline-flex items-center p-1 bg-slate-100 rounded-lg"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'url'}
              onClick={() => {
                setMode('url');
                setError(null);
              }}
              className={`px-3.5 py-2 inline-flex items-center gap-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'url'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Da URL web</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'text'}
              onClick={() => {
                setMode('text');
                setError(null);
              }}
              className={`px-3.5 py-2 inline-flex items-center gap-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'text'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Testo libero</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="target-multiplier" className="text-xs font-medium text-slate-600">
              Moltiplicatore target
            </label>
            <select
              id="target-multiplier"
              value={multiplier}
              onChange={(e) => setMultiplier(Number(e.target.value))}
              className="h-9 px-3 text-xs font-mono font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:border-[#166534]"
            >
              <option value={1}>1.0x (Originale)</option>
              <option value={1.25}>1.25x (+25%)</option>
              <option value={1.5}>1.5x (5 porz. abbondanti)</option>
              <option value={1.75}>1.75x</option>
              <option value={2}>2.0x (Doppio)</option>
            </select>
          </div>
        </div>

        {mode === 'url' ? (
          <div>
            <label htmlFor="recipe-url" className="block text-sm font-medium text-slate-800 mb-2">
              URL della ricetta
            </label>
            <input
              id="recipe-url"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://ricette.giallozafferano.it/Spezzatino-di-manzo-con-patate.html"
              className="w-full h-11 px-3.5 text-sm text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534]"
            />
            <p className="mt-2 text-xs text-slate-500">
              Estrazione automatica Schema.org JSON-LD, foto ad alta risoluzione e controllo
              anti-duplicati su SQLite prima della conversione.
            </p>
          </div>
        ) : (
          <div>
            <label htmlFor="recipe-text" className="block text-sm font-medium text-slate-800 mb-2">
              Testo della ricetta (ingredienti e procedimento)
            </label>
            <textarea
              id="recipe-text"
              rows={9}
              value={textInput}
              onChange={(e) => {
                setTextInput(e.target.value);
                if (!e.target.value.trim()) setSampleCoverUrl(null);
              }}
              placeholder="Incolla qui titolo, porzioni, elenco ingredienti e passaggi della ricetta (anche in formato Bimby/Thermomix o tradizionale)..."
              className="w-full p-3.5 text-sm text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] leading-relaxed"
            />
          </div>
        )}

        {/* Blocked URL Duplicate notice */}
        {blockedDuplicate && blockedDuplicate.hasDuplicate && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-950">
                <p className="font-medium">Ricetta già importata nello storico locale:</p>
                <p className="text-xs text-amber-900 mt-0.5">
                  {blockedDuplicate.matches[0]?.title}
                  {blockedDuplicate.matches[0]?.importedAt
                    ? ` · importata il ${new Date(blockedDuplicate.matches[0].importedAt).toLocaleDateString('it-IT')}`
                    : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forceReimport}
              onChange={(e) => setForceReimport(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-[#166534] focus:ring-[#166534]"
            />
            <span>Forza re-importazione anche se già presente nello storico</span>
          </label>

          <button
            type="submit"
            disabled={converting}
            className="h-11 px-5 inline-flex items-center gap-2 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {converting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Conversione AI in corso...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Analizza e Converti per MC Smart</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Quick Test Sample Recipes */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Ricette di esempio per test rapido
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Carica una ricetta italiana da 4 porzioni per verificare subito lo scaling 1,5x e la
              sostituzione con i programmi Rosolare e Cottura lenta.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {SAMPLE_RECIPES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => loadSample(sample)}
              className="group text-left bg-white border border-slate-200 hover:border-[#166534]/60 rounded-xl overflow-hidden transition-colors flex flex-col"
            >
              <div className="aspect-[4/3] w-full bg-slate-100 overflow-hidden">
                <img
                  src={sample.coverImageUrl}
                  alt={sample.label}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 group-hover:text-[#166534] transition-colors">
                    {sample.label}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">{sample.sourceLabel}</p>
                </div>
                <span className="text-xs font-medium text-[#166534]">Carica nel convertitore →</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
