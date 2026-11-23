export type McCategory =
  | 'Piatti principali'
  | 'Zuppe & stufati'
  | 'Salse e condimenti'
  | 'Contorni'
  | 'Insalate'
  | 'Spuntini'
  | 'Antipasti'
  | 'One-Pot / All-in-One'
  | 'Dolci'
  | 'Cuocere al forno'
  | 'Colazione'
  | 'Cena'
  | 'Bevande'
  | 'Marmellate & gelatina'
  | 'Alimenti per bambini'
  | 'Tagliaverdure'
  | 'Vegano'
  | 'Vegetariano'
  | 'Cucina italiana'
  | 'Cucina tedesca'
  | 'Cucina francese'
  | 'Cucina spagnola'
  | 'Cucina polacca';

export const MC_CATEGORIES: readonly McCategory[] = [
  'Piatti principali',
  'Zuppe & stufati',
  'Salse e condimenti',
  'Contorni',
  'Insalate',
  'Spuntini',
  'Antipasti',
  'One-Pot / All-in-One',
  'Dolci',
  'Cuocere al forno',
  'Colazione',
  'Cena',
  'Bevande',
  'Marmellate & gelatina',
  'Alimenti per bambini',
  'Tagliaverdure',
  'Vegano',
  'Vegetariano',
  'Cucina italiana',
  'Cucina tedesca',
  'Cucina francese',
  'Cucina spagnola',
  'Cucina polacca',
] as const;

const LEGACY_CATEGORY_ALIASES: Record<string, McCategory> = {
  'Primi piatti': 'Piatti principali',
  'Secondi piatti': 'Piatti principali',
  'Zuppe e minestre': 'Zuppe & stufati',
  'Salse e sughi': 'Salse e condimenti',
  'Impasti e lievitati': 'Cuocere al forno',
};

export function normalizeMcCategory(raw: unknown): McCategory {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if ((MC_CATEGORIES as readonly string[]).includes(trimmed)) {
      return trimmed as McCategory;
    }
    if (trimmed in LEGACY_CATEGORY_ALIASES) {
      return LEGACY_CATEGORY_ALIASES[trimmed];
    }
  }
  return 'Piatti principali';
}

export type McProgramMode =
  | 'manual'
  | 'rosolare'
  | 'cottura_lenta'
  | 'cuocere'
  | 'impastare'
  | 'vapore'
  | 'frullare'
  | 'turbo'
  | 'prep';

export interface McProgramMeta {
  id: McProgramMode;
  label: string;
  mcInternalKey: string;
  description: string;
  defaultTempC: number | null;
  supportsReverse: boolean;
}

export const MC_PROGRAMS: Record<McProgramMode, McProgramMeta> = {
  manual: {
    id: 'manual',
    label: 'Manuale',
    mcInternalKey: 'custom',
    description: 'Controllo diretto tempo, temperatura e velocità 1–10',
    defaultTempC: null,
    supportsReverse: true,
  },
  rosolare: {
    id: 'rosolare',
    label: 'Rosolare',
    mcInternalKey: 'roasting',
    description: 'Soffritti fino a 130°C e tostatura riso/carni',
    defaultTempC: 130,
    supportsReverse: false,
  },
  cottura_lenta: {
    id: 'cottura_lenta',
    label: 'Cottura lenta',
    mcInternalKey: 'slow_cooking',
    description: 'Rotazione lenta intermittente 37–95°C (anti-sfaldamento)',
    defaultTempC: 90,
    supportsReverse: false,
  },
  cuocere: {
    id: 'cuocere',
    label: 'Cuocere / Bollire',
    mcInternalKey: 'cooking',
    description: 'Bollitura controllata, pasta risottata, zuppe e legumi',
    defaultTempC: 100,
    supportsReverse: false,
  },
  impastare: {
    id: 'impastare',
    label: 'Impastare',
    mcInternalKey: 'kneading',
    description: 'Programma automatico per impasti solidi, morbidi o lievitati',
    defaultTempC: null,
    supportsReverse: false,
  },
  vapore: {
    id: 'vapore',
    label: 'Cottura a vapore',
    mcInternalKey: 'steaming',
    description: 'Cottura delicata con cestello vapore superiore',
    defaultTempC: 120,
    supportsReverse: false,
  },
  frullare: {
    id: 'frullare',
    label: 'Frullare / Passare',
    mcInternalKey: 'pureeing',
    description: 'Vellutate, creme e salse lisce',
    defaultTempC: null,
    supportsReverse: false,
  },
  turbo: {
    id: 'turbo',
    label: 'Turbo',
    mcInternalKey: 'turbo',
    description: 'Impulsi ad alta potenza per tritare',
    defaultTempC: null,
    supportsReverse: false,
  },
  prep: {
    id: 'prep',
    label: 'Preparazione / Bilancia',
    mcInternalKey: 'text',
    description: 'Passaggio manuale senza motore (pesatura, assemblaggio, servizio)',
    defaultTempC: null,
    supportsReverse: false,
  },
};

export interface RecipeIngredient {
  id: string;
  name: string;
  originalAmount: number | null;
  amount: number | null;
  unit: string;
  note?: string;
  isSeasoning: boolean;
  weighInBowl: boolean;
  estimatedVolumeMl?: number;
}

export interface RecipeStep {
  id: string;
  stepNumber: number;
  instruction: string;
  program: McProgramMode;
  durationSec: number;
  temperatureC: number | null;
  speed: number | null;
  reverse: boolean;
  useBladeCover: boolean;
  accessoryNote?: string;
  originalSummary?: string;
}

export interface NutritionInfo {
  kcal: number;
  proteine: number;
  carboidrati: number;
  grassi: number;
}

export interface ProposedChange {
  id: string;
  type: 'program_optimization' | 'scaling_adjustment' | 'capacity_safety' | 'time_adjustment' | 'blade_cover';
  title: string;
  reason: string;
  stepIndex: number | null;
  originalSummary: string;
  proposedSummary: string;
  accepted: boolean;
  // Snapshot for clean toggle revert/apply
  proposedStepPatch?: Partial<RecipeStep>;
  originalStepPatch?: Partial<RecipeStep>;
}

export interface BowlCapacityReport {
  estimatedVolumeMl: number;
  maxVolumeMl: number;
  fillPercent: number;
  dryRiceOrPastaGrams: number;
  vegAndLiquidGrams: number;
  status: 'ok' | 'warning' | 'exceeded';
  warnings: string[];
}

export interface ConvertedRecipe {
  title: string;
  description: string;
  sourceUrl: string | null;
  sourceDomain: string | null;
  category: McCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  originalServings: number;
  targetServings: number;
  appliedMultiplier: number;
  prepTimeMin: number;
  cookTimeMin: number;
  totalTimeMin: number;
  coverImageUrl: string | null;
  nutrition: NutritionInfo;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  proposedChanges: ProposedChange[];
  bowlCapacity: BowlCapacityReport;
  notes?: string;
}

export interface DuplicateMatch {
  source: 'local_url' | 'local_title' | 'remote_mc';
  similarity: number;
  title: string;
  sourceUrl?: string | null;
  remoteId?: string | null;
  remoteUrl?: string | null;
  importedAt?: string | null;
}

export interface DuplicateCheckResult {
  hasDuplicate: boolean;
  matches: DuplicateMatch[];
  remoteChecked: boolean;
  remoteCheckError?: string;
}

export interface StoredRecipeRecord {
  id: number;
  title: string;
  titleHash: string;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  category: McCategory;
  originalServings: number;
  targetServings: number;
  appliedMultiplier: number;
  nutrition: NutritionInfo;
  remoteId: string | null;
  remoteUrl: string | null;
  uploadStatus: 'synced' | 'local_draft' | 'failed';
  coverImageUrl: string | null;
  recipeJson: ConvertedRecipe;
  createdAt: string;
  updatedAt: string;
}

export interface McSessionStatus {
  authenticated: boolean;
  expired: boolean;
  email: string | null;
  cookieCount: number;
  savedAt: string | null;
  expiresAt: string | null;
  source: 'direct_login' | 'imported_json' | 'none';
  lastError?: string | null;
}

export interface AppSettingsView {
  hasAppPassword: boolean;
  appPasswordSource: 'env' | 'db_claimed' | 'none';
  hasGeminiKey: boolean;
  geminiKeySource: 'env' | 'none';
  mcEmail: string;
  hasMcPassword: boolean;
  defaultMultiplier: number;
  mcBaseUrl: string;
  mcLocale: string;
  envFilePath: string;
  mcSession: McSessionStatus;
}
