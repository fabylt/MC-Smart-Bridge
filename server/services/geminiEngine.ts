import { GoogleGenAI, Type, type Schema } from '@google/genai';
import crypto from 'node:crypto';
import {
  MC_CATEGORIES,
  type ConvertedRecipe,
  type McCategory,
  type McProgramMode,
  type ProposedChange,
  type RecipeIngredient,
  type RecipeStep,
} from '../../src/shared/types';
import { evaluateBowlCapacity, scaleAllIngredients } from '../lib/scaling';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

export class GeminiUpstreamError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function extractGeminiErrorInfo(err: unknown): { code: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error) {
      const code = Number(parsed.error.code) || 500;
      if (code === 503) {
        return {
          code: 503,
          message: 'Il servizio Gemini è momentaneamente sovraccarico. Riprova tra qualche secondo.',
        };
      }
      if (code === 429) {
        return {
          code: 429,
          message: 'Quota API Gemini temporaneamente esaurita (429). Riprova tra poco o verifica il piano della chiave.',
        };
      }
      if (code === 400 || code === 403) {
        return {
          code,
          message: 'Chiave GEMINI_API_KEY non valida o priva di permessi. Verifica la configurazione.',
        };
      }
      return { code, message: parsed.error.message || raw };
    }
  } catch {
    // Raw message is not JSON
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return {
      code: 503,
      message: 'Il servizio Gemini è momentaneamente sovraccarico. Riprova tra qualche secondo.',
    };
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      code: 429,
      message: 'Quota API Gemini temporaneamente esaurita (429).',
    };
  }
  return { code: 502, message: raw || 'Errore di comunicazione con Gemini AI.' };
}

async function generateWithRetry(
  ai: GoogleGenAI,
  request: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
) {
  const modelsToTry = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          ...request,
          model,
        });
        return { response, model };
      } catch (err) {
        lastError = err;
        const { code } = extractGeminiErrorInfo(err);
        if (code === 503 || code === 429) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  const info = extractGeminiErrorInfo(lastError);
  throw new GeminiUpstreamError(info.message, info.code);
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'Chiave GEMINI_API_KEY non configurata sul server. Configurala nelle Impostazioni o nei Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const recipeConversionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Titolo pulito in italiano della ricetta.' },
    description: {
      type: Type.STRING,
      description: 'Breve descrizione culinaria (2-3 frasi) della ricetta adattata per Monsieur Cuisine Smart.',
    },
    category: {
      type: Type.STRING,
      enum: [...MC_CATEGORIES],
      description: 'Categoria ufficiale Monsieur Cuisine Italia.',
    },
    difficulty: {
      type: Type.STRING,
      enum: ['easy', 'medium', 'hard'],
    },
    originalServings: {
      type: Type.INTEGER,
      description: 'Numero di porzioni della ricetta originale (default 4 se non specificato).',
    },
    targetServings: {
      type: Type.INTEGER,
      description: 'Numero di porzioni target (es. 5 porzioni abbondanti quando applicato 1.5x da 4).',
    },
    appliedMultiplier: {
      type: Type.NUMBER,
      description: 'Moltiplicatore applicato agli ingredienti principali (es. 1.5).',
    },
    prepTimeMin: { type: Type.INTEGER },
    cookTimeMin: { type: Type.INTEGER },
    totalTimeMin: { type: Type.INTEGER },
    nutrition: {
      type: Type.OBJECT,
      properties: {
        kcal: { type: Type.INTEGER, description: 'Calorie per singola porzione target.' },
        proteine: { type: Type.NUMBER, description: 'Proteine in grammi per porzione.' },
        carboidrati: { type: Type.NUMBER, description: 'Carboidrati in grammi per porzione.' },
        grassi: { type: Type.NUMBER, description: 'Grassi in grammi per porzione.' },
      },
      required: ['kcal', 'proteine', 'carboidrati', 'grassi'],
    },
    ingredients: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          originalAmount: {
            type: Type.NUMBER,
            nullable: true,
            description: 'Quantità originale prima del riproporzionamento (null se q.b.).',
          },
          unit: {
            type: Type.STRING,
            description: 'Unità di misura (g, ml, pz, cucchiai, spicchi, q.b., ecc.).',
          },
          note: { type: Type.STRING, nullable: true },
          isSeasoning: {
            type: Type.BOOLEAN,
            description:
              'True per sale, pepe, spezie, peperoncino, aglio, zucchero e olio del soffritto (scalati max 1.2x-1.3x).',
          },
          weighInBowl: {
            type: Type.BOOLEAN,
            description: 'True se l’ingrediente si pesa nella bilancia integrata del Monsieur Cuisine.',
          },
        },
        required: ['name', 'unit', 'isSeasoning', 'weighInBowl'],
      },
    },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepNumber: { type: Type.INTEGER },
          instruction: {
            type: Type.STRING,
            description: 'Testo chiaro dello step per Monsieur Cuisine Smart.',
          },
          program: {
            type: Type.STRING,
            enum: [
              'manual',
              'rosolare',
              'cottura_lenta',
              'cuocere',
              'impastare',
              'vapore',
              'frullare',
              'turbo',
              'prep',
            ],
          },
          durationSec: { type: Type.INTEGER, description: 'Durata in secondi (0 se solo preparazione).' },
          temperatureC: {
            type: Type.INTEGER,
            nullable: true,
            description: 'Temperatura in °C (37-130) oppure null se a freddo.',
          },
          speed: {
            type: Type.INTEGER,
            nullable: true,
            description: 'Velocità 1-10 solo per modalità manual; null per programmi automatici o prep.',
          },
          reverse: {
            type: Type.BOOLEAN,
            description: 'True per senso antiorario quando si mescola senza tritare.',
          },
          useBladeCover: {
            type: Type.BOOLEAN,
            description: 'True se è consigliato il Coprilame per proteggere carne/verdure/legumi.',
          },
          accessoryNote: { type: Type.STRING, nullable: true },
        },
        required: [
          'stepNumber',
          'instruction',
          'program',
          'durationSec',
          'reverse',
          'useBladeCover',
        ],
      },
    },
    proposedChanges: {
      type: Type.ARRAY,
      description:
        'Elenco esplicito delle ottimizzazioni AI proposte per revisione Human-in-the-Loop (programmi automatici, scaling non lineare, tempi, capienza, coprilame).',
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: [
              'program_optimization',
              'scaling_adjustment',
              'capacity_safety',
              'time_adjustment',
              'blade_cover',
            ],
          },
          title: { type: Type.STRING },
          reason: { type: Type.STRING },
          stepIndex: {
            type: Type.INTEGER,
            nullable: true,
            description: 'Indice 0-based dello step interessato (null se modifica globale/ingredienti).',
          },
          originalSummary: { type: Type.STRING },
          proposedSummary: { type: Type.STRING },
          originalProgram: {
            type: Type.STRING,
            nullable: true,
            enum: [
              'manual',
              'rosolare',
              'cottura_lenta',
              'cuocere',
              'impastare',
              'vapore',
              'frullare',
              'turbo',
              'prep',
            ],
          },
          originalDurationSec: { type: Type.INTEGER, nullable: true },
          originalTemperatureC: { type: Type.INTEGER, nullable: true },
          originalSpeed: { type: Type.INTEGER, nullable: true },
          originalReverse: { type: Type.BOOLEAN, nullable: true },
          originalUseBladeCover: { type: Type.BOOLEAN, nullable: true },
        },
        required: ['type', 'title', 'reason', 'originalSummary', 'proposedSummary'],
      },
    },
    notes: { type: Type.STRING, nullable: true },
  },
  required: [
    'title',
    'description',
    'category',
    'difficulty',
    'originalServings',
    'targetServings',
    'appliedMultiplier',
    'prepTimeMin',
    'cookTimeMin',
    'totalTimeMin',
    'nutrition',
    'ingredients',
    'steps',
    'proposedChanges',
  ],
};

const SYSTEM_INSTRUCTION = `Sei uno chef ingegnere specializzato nel robot da cucina Silvercrest Monsieur Cuisine Smart (MC3.0) e nella conversione di ricette tradizionali o Bimby/Thermomix.
Devi trasformare la ricetta sorgente in un JSON strutturato ottimizzato per Monsieur Cuisine Smart rispettando RIGOROSAMENTE queste regole tecniche:

1. RIPROPORZIONAMENTO INTELLIGENTE (Target: 5 porzioni abbondanti):
   - Se la ricetta originale è per 4 porzioni o meno, imposta il moltiplicatore richiesto (di default 1.5x, producendo 5 porzioni abbondanti).
   - Marca con "isSeasoning: true" sale, pepe, spezie, peperoncino, aglio, zucchero e olio del soffritto (verranno scalati non linearmente max 1.2x–1.3x).
   - Fornisci sempre "originalAmount" (quantità originale della ricetta) per ogni ingrediente numerico.
   - Adegua i tempi di cottura quando si scala verso l'alto (+1/+2 min su soffritti, +2/+3 min su bolliture).

2. OTTIMIZZAZIONE MECCANICA E PROGRAMMI AUTOMATICI (ANTI-SFALDAMENTO):
   - La Velocità 1 del Monsieur Cuisine Smart (~120-130 rpm) è troppo veloce e continua per preparazioni delicate (spezzatini, risotti, legumi, verdure a cubetti, pasta risottata, ragù).
   - Sostituisci la modalità manuale continua con i programmi automatici nativi:
     * "rosolare": soffritti fino a 130°C, rosolatura carne o tostatura riso.
     * "cottura_lenta": cotture delicate 37–95°C con rotazione lenta e intermittente (spezzatini, ragù, legumi, verdure a pezzi).
     * "cuocere": bolliture, pasta risottata, risotti in liquido, zuppe.
     * "impastare": impasti pane/pizza/dolci.
     * "vapore", "frullare", "turbo", "prep": dove appropriato.
   - Quando serve comunque modalità "manual" per mescolare senza tagliare, imposta SEMPRE "reverse: true" (Antiorario) e "useBladeCover: true" (Coprilame).

3. CATEGORIE E NUTRIZIONE:
   - Mappa la categoria esattamente su una delle categorie ufficiali Monsieur Cuisine Italia: ${MC_CATEGORIES.join(', ')}.
   - Calcola accuratamente i 4 valori nutrizionali PER PORZIONE TARGET (kcal, proteine, carboidrati, grassi) basati sugli ingredienti scalati divisi per targetServings.

4. PROPOSTE HUMAN-IN-THE-LOOP ("proposedChanges"):
   - Documenta ogni sostituzione significativa (es. "Sostituito Step 3 manuale con programma 'Cottura lenta' per evitare che lo spezzatino si sfaldi", "Ingredienti principali scalati 1,5x con condimenti limitati a 1,25x", "Aggiunto +2 min al soffritto per volume maggiore", "Consigliato Coprilame").
   - Per ogni modifica legata a uno step, compila stepIndex (0-based) e i parametri originali (originalProgram, originalDurationSec, originalTemperatureC, originalSpeed, originalReverse, originalUseBladeCover) così l'utente può accettare o rifiutare la modifica con un click.`;

interface RawGeminiRecipe {
  title: string;
  description: string;
  category: McCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  originalServings: number;
  targetServings: number;
  appliedMultiplier: number;
  prepTimeMin: number;
  cookTimeMin: number;
  totalTimeMin: number;
  nutrition: {
    kcal: number;
    proteine: number;
    carboidrati: number;
    grassi: number;
  };
  ingredients: Array<{
    name: string;
    originalAmount?: number | null;
    unit: string;
    note?: string | null;
    isSeasoning: boolean;
    weighInBowl: boolean;
  }>;
  steps: Array<{
    stepNumber: number;
    instruction: string;
    program: McProgramMode;
    durationSec: number;
    temperatureC?: number | null;
    speed?: number | null;
    reverse: boolean;
    useBladeCover: boolean;
    accessoryNote?: string | null;
  }>;
  proposedChanges: Array<{
    type: ProposedChange['type'];
    title: string;
    reason: string;
    stepIndex?: number | null;
    originalSummary: string;
    proposedSummary: string;
    originalProgram?: McProgramMode | null;
    originalDurationSec?: number | null;
    originalTemperatureC?: number | null;
    originalSpeed?: number | null;
    originalReverse?: boolean | null;
    originalUseBladeCover?: boolean | null;
  }>;
  notes?: string | null;
}

export async function convertRecipeWithGemini(params: {
  rawText: string;
  sourceUrl: string | null;
  sourceDomain: string | null;
  coverImageUrl: string | null;
  requestedMultiplier: number;
  servingsHint?: number | null;
}): Promise<ConvertedRecipe> {
  const ai = createGeminiClient();

  const userPrompt = [
    `Moltiplicatore target richiesto dall'utente: ${params.requestedMultiplier}x (se la ricetta è già >= 6 porzioni, rispetta comunque il moltiplicatore richiesto ${params.requestedMultiplier}x).`,
    params.servingsHint ? `Indicazione porzioni rilevate dalla sorgente: ${params.servingsHint}.` : '',
    params.sourceUrl ? `URL sorgente: ${params.sourceUrl}` : 'Sorgente: Testo libero incollato dall’utente.',
    '',
    '--- TESTO RICETTA SORGENTE ---',
    params.rawText.slice(0, 14000),
  ]
    .filter(Boolean)
    .join('\n');

  const { response } = await generateWithRetry(ai, {
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: recipeConversionSchema,
    },
  });

  const text = (response.text || '').trim();
  if (!text) {
    throw new Error('Risposta vuota dal motore Gemini.');
  }

  let parsed: RawGeminiRecipe;
  try {
    parsed = JSON.parse(text) as RawGeminiRecipe;
  } catch {
    throw new Error('Impossibile decodificare il JSON restituito da Gemini.');
  }

  const appliedMultiplier =
    Number.isFinite(params.requestedMultiplier) && params.requestedMultiplier > 0
      ? params.requestedMultiplier
      : parsed.appliedMultiplier || 1.5;

  const baseIngredients: RecipeIngredient[] = (parsed.ingredients || []).map((ing) => ({
    id: crypto.randomUUID(),
    name: ing.name.trim(),
    originalAmount:
      typeof ing.originalAmount === 'number' && Number.isFinite(ing.originalAmount)
        ? ing.originalAmount
        : null,
    amount:
      typeof ing.originalAmount === 'number' && Number.isFinite(ing.originalAmount)
        ? ing.originalAmount
        : null,
    unit: (ing.unit || '').trim(),
    note: ing.note?.trim() || undefined,
    isSeasoning: Boolean(ing.isSeasoning),
    weighInBowl: Boolean(ing.weighInBowl),
  }));

  // Apply deterministic non-linear scaling & practical rounding server-side
  const scaledIngredients = scaleAllIngredients(baseIngredients, appliedMultiplier);
  const bowlCapacity = evaluateBowlCapacity(scaledIngredients);

  const steps: RecipeStep[] = (parsed.steps || []).map((s, idx) => ({
    id: crypto.randomUUID(),
    stepNumber: idx + 1,
    instruction: s.instruction.trim(),
    program: s.program || 'manual',
    durationSec: Math.max(0, Math.round(s.durationSec || 0)),
    temperatureC: typeof s.temperatureC === 'number' ? Math.round(s.temperatureC) : null,
    speed: s.program === 'manual' && typeof s.speed === 'number' ? Math.min(10, Math.max(1, Math.round(s.speed))) : null,
    reverse: Boolean(s.reverse),
    useBladeCover: Boolean(s.useBladeCover),
    accessoryNote: s.accessoryNote?.trim() || undefined,
  }));

  const proposedChanges: ProposedChange[] = (parsed.proposedChanges || []).map((c) => {
    const idx =
      typeof c.stepIndex === 'number' && c.stepIndex >= 0 && c.stepIndex < steps.length
        ? c.stepIndex
        : null;
    const targetStep = idx !== null ? steps[idx] : null;

    return {
      id: crypto.randomUUID(),
      type: c.type || 'program_optimization',
      title: c.title.trim(),
      reason: c.reason.trim(),
      stepIndex: idx,
      originalSummary: c.originalSummary.trim(),
      proposedSummary: c.proposedSummary.trim(),
      accepted: true,
      proposedStepPatch: targetStep
        ? {
            program: targetStep.program,
            durationSec: targetStep.durationSec,
            temperatureC: targetStep.temperatureC,
            speed: targetStep.speed,
            reverse: targetStep.reverse,
            useBladeCover: targetStep.useBladeCover,
          }
        : undefined,
      originalStepPatch:
        targetStep && (c.originalProgram || c.originalDurationSec !== undefined || c.originalSpeed !== undefined)
          ? {
              program: c.originalProgram || 'manual',
              durationSec:
                typeof c.originalDurationSec === 'number'
                  ? c.originalDurationSec
                  : targetStep.durationSec,
              temperatureC:
                c.originalTemperatureC !== undefined
                  ? c.originalTemperatureC
                  : targetStep.temperatureC,
              speed: c.originalSpeed !== undefined ? c.originalSpeed : 1,
              reverse:
                typeof c.originalReverse === 'boolean' ? c.originalReverse : targetStep.reverse,
              useBladeCover:
                typeof c.originalUseBladeCover === 'boolean' ? c.originalUseBladeCover : false,
            }
          : undefined,
    };
  });

  // Add automatic capacity warning proposal if bowl is near/over 3L and AI didn't already list one
  if (
    bowlCapacity.warnings.length > 0 &&
    !proposedChanges.some((c) => c.type === 'capacity_safety')
  ) {
    proposedChanges.push({
      id: crypto.randomUUID(),
      type: 'capacity_safety',
      title: `Controllo capienza boccale 3 L (${bowlCapacity.fillPercent}%)`,
      reason: bowlCapacity.warnings.join(' '),
      stepIndex: null,
      originalSummary: `Volume stimato ${bowlCapacity.estimatedVolumeMl} ml`,
      proposedSummary: 'Verifica tacca MAX e usa misurino inclinato o riduci moltiplicatore',
      accepted: true,
    });
  }

  const origServings = Math.max(1, Math.round(parsed.originalServings || params.servingsHint || 4));
  const targetServings =
    origServings <= 4 && appliedMultiplier === 1.5
      ? 5
      : Math.max(1, Math.round(origServings * appliedMultiplier));

  return {
    title: parsed.title.trim(),
    description: parsed.description.trim(),
    sourceUrl: params.sourceUrl,
    sourceDomain: params.sourceDomain,
    category: MC_CATEGORIES.includes(parsed.category) ? parsed.category : 'Piatti principali',
    difficulty: parsed.difficulty || 'medium',
    originalServings: origServings,
    targetServings,
    appliedMultiplier,
    prepTimeMin: Math.max(1, Math.round(parsed.prepTimeMin || 15)),
    cookTimeMin: Math.max(0, Math.round(parsed.cookTimeMin || 30)),
    totalTimeMin: Math.max(
      1,
      Math.round(parsed.totalTimeMin || (parsed.prepTimeMin || 15) + (parsed.cookTimeMin || 30))
    ),
    coverImageUrl: params.coverImageUrl,
    nutrition: {
      kcal: Math.max(0, Math.round(parsed.nutrition?.kcal || 0)),
      proteine: Number(Math.max(0, parsed.nutrition?.proteine || 0).toFixed(1)),
      carboidrati: Number(Math.max(0, parsed.nutrition?.carboidrati || 0).toFixed(1)),
      grassi: Number(Math.max(0, parsed.nutrition?.grassi || 0).toFixed(1)),
    },
    ingredients: scaledIngredients,
    steps,
    proposedChanges,
    bowlCapacity,
    notes: parsed.notes?.trim() || undefined,
  };
}

export async function testGeminiConnection(): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
}> {
  const start = Date.now();
  try {
    const ai = createGeminiClient();
    const { response: resp, model } = await generateWithRetry(ai, {
      contents: 'Rispondi esattamente con: OK',
    });
    const latencyMs = Date.now() - start;
    const reply = (resp.text || '').trim();
    return {
      ok: true,
      model,
      latencyMs,
      message: `Connessione AI attiva (${model}, risposta "${reply.slice(0, 20)}" in ${latencyMs} ms).`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const info = extractGeminiErrorInfo(err);
    return {
      ok: false,
      model: PRIMARY_MODEL,
      latencyMs,
      message: `Test AI fallito: ${info.message}`,
    };
  }
}
