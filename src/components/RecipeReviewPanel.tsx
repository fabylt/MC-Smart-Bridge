import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  ExternalLink,
  ImagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import {
  MC_CATEGORIES,
  MC_PROGRAMS,
  type ConvertedRecipe,
  type DuplicateCheckResult,
  type McCategory,
  type McProgramMode,
  type ProposedChange,
  type RecipeIngredient,
  type RecipeStep,
} from '../shared/types';
import { api, ApiError } from '../lib/api';

interface RecipeReviewPanelProps {
  initialRecipe: ConvertedRecipe;
  initialDuplicateCheck: DuplicateCheckResult;
  onBack: () => void;
  onUploaded: (message: string, uploadedToCloud: boolean) => void;
}

const MULTIPLIER_PRESETS = [1.0, 1.25, 1.5, 1.75, 2.0];

function applyStepPatchLocally(
  steps: RecipeStep[],
  change: ProposedChange,
  accepted: boolean
): RecipeStep[] {
  if (change.stepIndex === null || change.stepIndex < 0 || change.stepIndex >= steps.length) {
    return steps;
  }
  const patch = accepted ? change.proposedStepPatch : change.originalStepPatch;
  if (!patch) return steps;
  return steps.map((s, idx) => (idx === change.stepIndex ? { ...s, ...patch } : s));
}

function formatDuration(sec: number): string {
  if (sec <= 0) return '0 sec';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} sec`;
  if (s === 0) return `${m} min`;
  return `${m} min ${s} sec`;
}

export function RecipeReviewPanel({
  initialRecipe,
  initialDuplicateCheck,
  onBack,
  onUploaded,
}: RecipeReviewPanelProps) {
  const [recipe, setRecipe] = useState<ConvertedRecipe>(initialRecipe);
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckResult>(initialDuplicateCheck);
  const [forceReimport, setForceReimport] = useState(false);
  const [customMultiplier, setCustomMultiplier] = useState(String(initialRecipe.appliedMultiplier));
  const [rescaling, setRescaling] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const acceptedCount = useMemo(
    () => recipe.proposedChanges.filter((c) => c.accepted).length,
    [recipe.proposedChanges]
  );

  async function handleRescale(nextMult: number) {
    if (!Number.isFinite(nextMult) || nextMult < 0.5 || nextMult > 3.0) return;
    setError(null);
    setRescaling(true);
    try {
      const res = await api.rescaleRecipe(recipe, nextMult);
      setRecipe(res.recipe);
      setCustomMultiplier(String(res.recipe.appliedMultiplier));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel riproporzionamento.');
    } finally {
      setRescaling(false);
    }
  }

  function handleToggleProposal(changeId: string) {
    setRecipe((prev) => {
      const target = prev.proposedChanges.find((c) => c.id === changeId);
      if (!target) return prev;
      const nextAccepted = !target.accepted;
      const nextChanges = prev.proposedChanges.map((c) =>
        c.id === changeId ? { ...c, accepted: nextAccepted } : c
      );
      const nextSteps = applyStepPatchLocally(prev.steps, target, nextAccepted);
      return {
        ...prev,
        proposedChanges: nextChanges,
        steps: nextSteps,
      };
    });
  }

  function updateIngredient(id: string, patch: Partial<RecipeIngredient>) {
    setRecipe((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)),
    }));
  }

  function addIngredient() {
    setRecipe((prev) => ({
      ...prev,
      ingredients: [
        ...prev.ingredients,
        {
          id: `ing-${Date.now()}`,
          name: '',
          originalAmount: null,
          amount: 100,
          unit: 'g',
          isSeasoning: false,
          weighInBowl: true,
        },
      ],
    }));
  }

  function removeIngredient(id: string) {
    setRecipe((prev) => ({
      ...prev,
      ingredients: prev.ingredients.filter((ing) => ing.id !== id),
    }));
  }

  function updateStep(id: string, patch: Partial<RecipeStep>) {
    setRecipe((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }

  function addStep() {
    setRecipe((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        {
          id: `step-${Date.now()}`,
          stepNumber: prev.steps.length + 1,
          instruction: '',
          program: 'manual',
          durationSec: 180,
          temperatureC: 100,
          speed: 1,
          reverse: true,
          useBladeCover: false,
        },
      ],
    }));
  }

  function removeStep(id: string) {
    setRecipe((prev) => ({
      ...prev,
      steps: prev.steps
        .filter((s) => s.id !== id)
        .map((s, idx) => ({ ...s, stepNumber: idx + 1 })),
    }));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingPhoto(true);
    try {
      const res = await api.uploadCoverImage(file);
      setImageBroken(false);
      setRecipe((prev) => ({ ...prev, coverImageUrl: res.coverImageUrl }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore nel caricamento immagine.');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleApproveAndUpload() {
    setError(null);
    if (!recipe.title.trim()) {
      setError('Il titolo della ricetta è obbligatorio.');
      return;
    }
    if (duplicateCheck.hasDuplicate && !forceReimport) {
      setError(
        'Duplicato rilevato: spunta "Forza re-importazione" se vuoi comunque salvare o sovrascrivere.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.approveAndUploadRecipe(recipe, forceReimport);
      onUploaded(res.message, res.uploadedToCloud);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.data?.duplicateCheck) {
        setDuplicateCheck(err.data.duplicateCheck as DuplicateCheckResult);
      }
      setError(err instanceof Error ? err.message : 'Errore durante il caricamento.');
    } finally {
      setSubmitting(false);
    }
  }

  const capacityTone =
    recipe.bowlCapacity.status === 'exceeded'
      ? 'bg-red-600'
      : recipe.bowlCapacity.status === 'warning'
        ? 'bg-amber-500'
        : 'bg-[#166534]';

  return (
    <div className="space-y-8 pb-16">
      {/* Top action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 mb-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Torna all’importazione</span>
          </button>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Revisione e Approvazione Ricetta
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Verifica le modifiche AI, regola quantità o programmi e approva l’invio verso
            monsieur-cuisine.com.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleApproveAndUpload}
            disabled={submitting}
            className="h-11 px-5 inline-flex items-center gap-2 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <CloudUpload className="w-4 h-4" />
            <span>
              {submitting ? 'Invio in corso...' : 'Approva e Carica su Monsieur Cuisine'}
            </span>
          </button>
        </div>
      </div>

      {/* Duplicate warning panel */}
      {duplicateCheck.hasDuplicate && (
        <section
          aria-label="Avviso duplicato"
          className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-amber-950">
                Possibile ricetta duplicata rilevata
              </h3>
              <p className="text-sm text-amber-900 mt-1">
                Il controllo anti-duplicati (SQLite locale + cloud Monsieur Cuisine, soglia &gt;85%)
                ha trovato una corrispondenza esistente:
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {duplicateCheck.matches.map((m, idx) => (
                  <li
                    key={`${m.source}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 bg-white/80 border border-amber-200 rounded-lg px-3.5 py-2"
                  >
                    <div className="min-w-0">
                      <span className="font-medium text-slate-900">{m.title}</span>
                      <span className="text-xs text-slate-600 ml-2">
                        {m.source === 'local_url'
                          ? 'Stesso URL in SQLite'
                          : m.source === 'remote_mc'
                            ? `Cloud Monsieur Cuisine · ${Math.round(m.similarity * 100)}% simile`
                            : `Archivio locale · ${Math.round(m.similarity * 100)}% simile`}
                      </span>
                    </div>
                    {m.remoteUrl && (
                      <a
                        href={m.remoteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#166534] hover:underline whitespace-nowrap"
                      >
                        <span>Apri su MC</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <label className="mt-4 inline-flex items-center gap-2.5 text-sm font-medium text-amber-950 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceReimport}
                  onChange={(e) => setForceReimport(e.target.checked)}
                  className="w-4 h-4 rounded border-amber-400 text-[#166534] focus:ring-[#166534]"
                />
                <span>Forza re-importazione (ignora il blocco duplicati per questa ricetta)</span>
              </label>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div
          role="alert"
          className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          {error}
        </div>
      )}

      {/* Metadata + Cover Photo + Nutrition Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Core metadata */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="recipe-title"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                Titolo ricetta
              </label>
              <input
                id="recipe-title"
                type="text"
                value={recipe.title}
                onChange={(e) => setRecipe((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full h-10 px-3 text-base font-medium text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="recipe-desc"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                Descrizione
              </label>
              <textarea
                id="recipe-desc"
                rows={3}
                value={recipe.description}
                onChange={(e) => setRecipe((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full p-3 text-sm text-slate-800 border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
              />
            </div>

            <div>
              <label
                htmlFor="recipe-category"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                Categoria Monsieur Cuisine
              </label>
              <select
                id="recipe-category"
                value={recipe.category}
                onChange={(e) =>
                  setRecipe((prev) => ({ ...prev, category: e.target.value as McCategory }))
                }
                className="w-full h-10 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
              >
                {MC_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="recipe-difficulty"
                className="block text-xs font-medium text-slate-600 mb-1.5"
              >
                Difficoltà
              </label>
              <select
                id="recipe-difficulty"
                value={recipe.difficulty}
                onChange={(e) =>
                  setRecipe((prev) => ({
                    ...prev,
                    difficulty: e.target.value as ConvertedRecipe['difficulty'],
                  }))
                }
                className="w-full h-10 px-3 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
              >
                <option value="easy">Facile</option>
                <option value="medium">Media</option>
                <option value="hard">Difficile</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:col-span-2">
              <div>
                <label
                  htmlFor="recipe-servings"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Porzioni target
                </label>
                <input
                  id="recipe-servings"
                  type="number"
                  min={1}
                  max={20}
                  value={recipe.targetServings}
                  onChange={(e) =>
                    setRecipe((prev) => ({
                      ...prev,
                      targetServings: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="recipe-prep"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Prep (min)
                </label>
                <input
                  id="recipe-prep"
                  type="number"
                  min={0}
                  value={recipe.prepTimeMin}
                  onChange={(e) => {
                    const prep = Math.max(0, Number(e.target.value) || 0);
                    setRecipe((prev) => ({
                      ...prev,
                      prepTimeMin: prep,
                      totalTimeMin: prep + prev.cookTimeMin,
                    }));
                  }}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="recipe-cook"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Cottura (min)
                </label>
                <input
                  id="recipe-cook"
                  type="number"
                  min={0}
                  value={recipe.cookTimeMin}
                  onChange={(e) => {
                    const cook = Math.max(0, Number(e.target.value) || 0);
                    setRecipe((prev) => ({
                      ...prev,
                      cookTimeMin: cook,
                      totalTimeMin: prev.prepTimeMin + cook,
                    }));
                  }}
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* 4 Required Monsieur Cuisine Nutritional Values */}
          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Valori Nutrizionali per porzione (campi Monsieur Cuisine)
              </h3>
              <span className="text-xs text-slate-500">Modificabili manualmente</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label htmlFor="nut-kcal" className="block text-xs text-slate-600 mb-1">
                  kcal
                </label>
                <input
                  id="nut-kcal"
                  type="number"
                  min={0}
                  value={recipe.nutrition.kcal}
                  onChange={(e) =>
                    setRecipe((prev) => ({
                      ...prev,
                      nutrition: { ...prev.nutrition, kcal: Math.max(0, Number(e.target.value) || 0) },
                    }))
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nut-proteine" className="block text-xs text-slate-600 mb-1">
                  Proteine (g)
                </label>
                <input
                  id="nut-proteine"
                  type="number"
                  min={0}
                  step="0.1"
                  value={recipe.nutrition.proteine}
                  onChange={(e) =>
                    setRecipe((prev) => ({
                      ...prev,
                      nutrition: {
                        ...prev.nutrition,
                        proteine: Math.max(0, Number(e.target.value) || 0),
                      },
                    }))
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nut-carboidrati" className="block text-xs text-slate-600 mb-1">
                  Carboidrati (g)
                </label>
                <input
                  id="nut-carboidrati"
                  type="number"
                  min={0}
                  step="0.1"
                  value={recipe.nutrition.carboidrati}
                  onChange={(e) =>
                    setRecipe((prev) => ({
                      ...prev,
                      nutrition: {
                        ...prev.nutrition,
                        carboidrati: Math.max(0, Number(e.target.value) || 0),
                      },
                    }))
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="nut-grassi" className="block text-xs text-slate-600 mb-1">
                  Grassi (g)
                </label>
                <input
                  id="nut-grassi"
                  type="number"
                  min={0}
                  step="0.1"
                  value={recipe.nutrition.grassi}
                  onChange={(e) =>
                    setRecipe((prev) => ({
                      ...prev,
                      nutrition: {
                        ...prev.nutrition,
                        grassi: Math.max(0, Number(e.target.value) || 0),
                      },
                    }))
                  }
                  className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Cover image + Bowl capacity */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Foto di copertina</h3>
              <span className="text-xs text-slate-500">1200×800 JPEG</span>
            </div>

            <div className="aspect-[4/3] w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-100 relative">
              {recipe.coverImageUrl && !imageBroken ? (
                <img
                  src={recipe.coverImageUrl}
                  alt={recipe.title}
                  referrerPolicy="no-referrer"
                  onError={() => setImageBroken(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                  <UtensilsCrossed className="w-8 h-8 mb-2 stroke-[1.5]" />
                  <p className="text-xs text-slate-500">Nessuna foto estratta</p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={handlePhotoUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="mt-3 w-full h-10 px-3 inline-flex items-center justify-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
            >
              <ImagePlus className="w-4 h-4" />
              <span>{uploadingPhoto ? 'Ridimensionamento...' : 'Carica foto personalizzata (max 10 MB)'}</span>
            </button>
          </div>

          {/* 3L Bowl Capacity Meter */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                Capienza boccale (3,0 L)
              </span>
              <span className="font-mono tabular-nums text-slate-700 whitespace-nowrap">
                {recipe.bowlCapacity.estimatedVolumeMl} / {recipe.bowlCapacity.maxVolumeMl} ml (
                {recipe.bowlCapacity.fillPercent}%)
              </span>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-200 ${capacityTone}`}
                style={{ width: `${Math.min(100, recipe.bowlCapacity.fillPercent)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums">
              <span>Riso/Pasta: {recipe.bowlCapacity.dryRiceOrPastaGrams} g</span>
              <span>Massa: {recipe.bowlCapacity.vegAndLiquidGrams} g</span>
            </div>
            {recipe.bowlCapacity.warnings.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {recipe.bowlCapacity.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 leading-relaxed">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* Smart Scaling Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Riproporzionamento Intelligente (Originale: {recipe.originalServings} porz. → Target:{' '}
            {recipe.targetServings} porz.)
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Sale, spezie, aglio, zucchero e olio soffritto restano limitati a max 1,2x–1,3x con
            arrotondamento pratico ai 5/10 g e uova intere.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
            {MULTIPLIER_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={rescaling}
                onClick={() => handleRescale(m)}
                className={`px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                  Math.abs(recipe.appliedMultiplier - m) < 0.01
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m}x
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="custom-mult" className="sr-only">
              Moltiplicatore personalizzato
            </label>
            <input
              id="custom-mult"
              type="number"
              min={0.5}
              max={3.0}
              step={0.1}
              value={customMultiplier}
              onChange={(e) => setCustomMultiplier(e.target.value)}
              className="w-20 h-9 px-2.5 text-xs font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              disabled={rescaling}
              onClick={() => handleRescale(Number(customMultiplier))}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${rescaling ? 'animate-spin' : ''}`} />
              <span>Ricalcola</span>
            </button>
          </div>
        </div>
      </section>

      {/* Human-in-the-Loop AI Proposed Changes */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Modifiche proposte dall’AI ({acceptedCount}/{recipe.proposedChanges.length} attive)
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Accetta o rifiuta ogni singola ottimizzazione meccanica o di scala prima dell’invio.
            </p>
          </div>
        </div>

        {recipe.proposedChanges.length === 0 ? (
          <p className="text-sm text-slate-500">Nessuna modifica strutturale proposta.</p>
        ) : (
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            {recipe.proposedChanges.map((change) => (
              <div
                key={change.id}
                className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-900 text-sm">{change.title}</span>
                    {change.stepIndex !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Step {change.stepIndex + 1}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        change.accepted ? 'text-[#166534] font-medium' : 'text-slate-500'
                      }
                    >
                      {change.accepted ? 'Applicata' : 'Rifiutata'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{change.reason}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-1">
                    <span className="text-slate-500">
                      Originale: <span className="font-mono text-slate-700">{change.originalSummary}</span>
                    </span>
                    <span className="text-slate-400" aria-hidden="true">
                      →
                    </span>
                    <span className="text-slate-700">
                      Proposta:{' '}
                      <span className="font-mono font-medium text-[#166534]">
                        {change.proposedSummary}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleProposal(change.id)}
                    aria-pressed={change.accepted}
                    aria-label={
                      change.accepted
                        ? `Rifiuta modifica: ${change.title}`
                        : `Accetta modifica: ${change.title}`
                    }
                    className={`h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      change.accepted
                        ? 'bg-emerald-50 text-[#166534] border-emerald-200 hover:bg-emerald-100'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {change.accepted ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Accettata</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Rifiutata (Ripristina)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Ingredients Table */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Ingredienti ({recipe.ingredients.length})
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Quantità scalate con bilancia integrata (⚖️) e flag condimento non lineare.
            </p>
          </div>
          <button
            type="button"
            onClick={addIngredient}
            className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Aggiungi ingrediente</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                <th className="py-2.5 pr-3">Ingrediente</th>
                <th className="py-2.5 px-2 w-24 text-right">Orig.</th>
                <th className="py-2.5 px-2 w-28 text-right">Scalato</th>
                <th className="py-2.5 px-2 w-24">Unità</th>
                <th className="py-2.5 px-2 w-32">Tipo</th>
                <th className="py-2.5 px-2 w-24 text-center">Bilancia</th>
                <th className="py-2.5 pl-2 w-10">
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {recipe.ingredients.map((ing) => (
                <tr key={ing.id} className="hover:bg-slate-50/60">
                  <td className="py-2 pr-3 min-w-[200px]">
                    <input
                      type="text"
                      aria-label={`Nome ingrediente ${ing.name}`}
                      value={ing.name}
                      onChange={(e) => updateIngredient(ing.id, { name: e.target.value })}
                      className="w-full h-9 px-2.5 text-sm text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:bg-white focus:border-[#166534] rounded-md"
                    />
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-xs text-slate-500">
                    {ing.originalAmount !== null ? ing.originalAmount : '—'}
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      step="any"
                      aria-label={`Quantità scalata per ${ing.name}`}
                      value={ing.amount ?? ''}
                      onChange={(e) =>
                        updateIngredient(ing.id, {
                          amount: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className="w-full h-9 px-2 text-right text-sm font-mono tabular-nums text-slate-900 border border-slate-200 rounded-md focus:border-[#166534]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <input
                      type="text"
                      aria-label={`Unità per ${ing.name}`}
                      value={ing.unit}
                      onChange={(e) => updateIngredient(ing.id, { unit: e.target.value })}
                      className="w-full h-9 px-2 text-sm text-slate-700 border border-slate-200 rounded-md focus:border-[#166534]"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <button
                      type="button"
                      onClick={() => updateIngredient(ing.id, { isSeasoning: !ing.isSeasoning })}
                      className="text-xs text-slate-600 hover:text-slate-900 underline decoration-dotted underline-offset-4 whitespace-nowrap"
                    >
                      {ing.isSeasoning ? 'Condimento (≤1,3x)' : 'Base (1,5x)'}
                    </button>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      type="button"
                      onClick={() => updateIngredient(ing.id, { weighInBowl: !ing.weighInBowl })}
                      aria-label={`Bilancia integrata per ${ing.name}`}
                      aria-pressed={ing.weighInBowl}
                      className={`h-8 w-8 inline-flex items-center justify-center rounded-md border transition-colors ${
                        ing.weighInBowl
                          ? 'bg-emerald-50 border-emerald-200 text-[#166534]'
                          : 'bg-white border-slate-200 text-slate-400'
                      }`}
                    >
                      <Scale className="w-3.5 h-3.5" />
                    </button>
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeIngredient(ing.id)}
                      aria-label={`Rimuovi ${ing.name}`}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cooking Steps Editor */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Passaggi Monsieur Cuisine Smart ({recipe.steps.length})
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Modifica programma automatico, durata, temperatura, senso Antiorario o nota Coprilame.
            </p>
          </div>
          <button
            type="button"
            onClick={addStep}
            className="h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Aggiungi passaggio</span>
          </button>
        </div>

        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {recipe.steps.map((step, index) => (
            <div key={step.id} className="py-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    Step {index + 1}
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    /
                  </span>
                  <span className="text-xs text-slate-600 font-mono tabular-nums">
                    {MC_PROGRAMS[step.program]?.label || step.program} ·{' '}
                    {formatDuration(step.durationSec)}
                    {step.temperatureC ? ` · ${step.temperatureC}°C` : ''}
                    {step.program === 'manual' && step.speed ? ` · Vel. ${step.speed}` : ''}
                    {step.reverse ? ' · Antiorario' : ''}
                    {step.useBladeCover ? ' · Coprilame' : ''}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => removeStep(step.id)}
                  aria-label={`Rimuovi Step ${index + 1}`}
                  className="h-8 px-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Elimina</span>
                </button>
              </div>

              <textarea
                rows={2}
                aria-label={`Istruzioni Step ${index + 1}`}
                value={step.instruction}
                onChange={(e) => updateStep(step.id, { instruction: e.target.value })}
                className="w-full p-3 text-sm text-slate-800 border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
              />

              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">Programma MC Smart</label>
                  <select
                    value={step.program}
                    onChange={(e) => {
                      const nextProg = e.target.value as McProgramMode;
                      updateStep(step.id, {
                        program: nextProg,
                        speed: nextProg === 'manual' ? step.speed ?? 1 : null,
                        temperatureC:
                          step.temperatureC ?? MC_PROGRAMS[nextProg]?.defaultTempC ?? null,
                      });
                    }}
                    className="w-full h-9 px-2.5 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg"
                  >
                    {Object.values(MC_PROGRAMS).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">Durata (sec)</label>
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={step.durationSec}
                    onChange={(e) =>
                      updateStep(step.id, { durationSec: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-full h-9 px-2.5 text-xs font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">Temp (°C)</label>
                  <input
                    type="number"
                    min={0}
                    max={130}
                    placeholder="—"
                    value={step.temperatureC ?? ''}
                    onChange={(e) =>
                      updateStep(step.id, {
                        temperatureC: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full h-9 px-2.5 text-xs font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-500 mb-1">Velocità (1-10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    disabled={step.program !== 'manual'}
                    placeholder={step.program === 'manual' ? '1' : 'Auto'}
                    value={step.program === 'manual' ? (step.speed ?? 1) : ''}
                    onChange={(e) =>
                      updateStep(step.id, {
                        speed: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-full h-9 px-2.5 text-xs font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.reverse}
                      onChange={(e) => updateStep(step.id, { reverse: e.target.checked })}
                      className="rounded border-slate-300 text-[#166534] focus:ring-[#166534]"
                    />
                    <span>Antiorario</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={step.useBladeCover}
                      onChange={(e) => updateStep(step.id, { useBladeCover: e.target.checked })}
                      className="rounded border-slate-300 text-[#166534] focus:ring-[#166534]"
                    />
                    <span>Coprilame</span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Collapsible Payload JSON Inspector */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowJsonPreview((v) => !v)}
          aria-expanded={showJsonPreview}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div>
            <span className="text-sm font-semibold text-slate-900">
              Anteprima Payload API Monsieur Cuisine Smart (JSON)
            </span>
            <p className="text-xs text-slate-500 mt-0.5">
              Ispeziona i dati strutturati che verranno trasmessi all’account cloud.
            </p>
          </div>
          {showJsonPreview ? (
            <ChevronUp className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          )}
        </button>
        {showJsonPreview && (
          <pre className="p-6 pt-0 text-xs font-mono text-slate-800 bg-slate-50 border-t border-slate-200 overflow-x-auto max-h-96">
            {JSON.stringify(recipe, null, 2)}
          </pre>
        )}
      </section>

      {/* Bottom Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="h-11 px-4 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors"
        >
          Annulla e torna indietro
        </button>

        <button
          type="button"
          onClick={handleApproveAndUpload}
          disabled={submitting}
          className="h-11 px-6 inline-flex items-center gap-2 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
        >
          <CloudUpload className="w-4 h-4" />
          <span>
            {submitting ? 'Invio in corso...' : 'Approva e Carica su Monsieur Cuisine'}
          </span>
        </button>
      </div>
    </div>
  );
}
