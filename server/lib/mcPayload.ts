import {
  normalizeMcCategory,
  type ConvertedRecipe,
  type McCategory,
  type ProposedChange,
  type RecipeStep,
} from '../../src/shared/types';

/**
 * Official Monsieur Cuisine Smart (MC3.0) hardware constants & verified locale catalogs
 * aligned with gerkensm/smart-recipe and pgreda/Unofficial-Monsieur-Cuisine-MCP.
 */
export const MONSIEUR_CUISINE_SMART_DEVICE_TYPE_ID = 13 as const;

export const SMART_HEATING_TEMPERATURE_STEPS = [
  0, 37, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130,
] as const;

export const SMART_LOW_TEMPERATURE_STEPS = [
  37, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
] as const;

export const SUPPORTED_MC_LOCALES = [
  'it-IT',
  'de-DE',
  'fr-FR',
  'en-US',
  'pl-PL',
  'cs-CZ',
] as const;

export type SupportedMcLocale = (typeof SUPPORTED_MC_LOCALES)[number];

export const LOCALE_COMPLEXITY_IDS: Record<
  SupportedMcLocale,
  Record<'easy' | 'medium' | 'hard', number>
> = {
  'it-IT': { easy: 109, medium: 100, hard: 105 },
  'de-DE': { easy: 142, medium: 99, hard: 104 },
  'fr-FR': { easy: 108, medium: 98, hard: 103 },
  'en-US': { easy: 22, medium: 16, hard: 20 },
  'pl-PL': { easy: 159, medium: 102, hard: 106 },
  'cs-CZ': { easy: 537, medium: 536, hard: 538 },
};

const DEFAULT_INGREDIENT_GROUP_NAME: Record<SupportedMcLocale, string> = {
  'it-IT': 'Ingredienti',
  'de-DE': 'Zutaten',
  'fr-FR': 'Ingrédients',
  'en-US': 'Ingredients',
  'pl-PL': 'Składniki',
  'cs-CZ': 'Ingredience',
};

const DEFAULT_SERVING_UNIT: Record<SupportedMcLocale, string> = {
  'it-IT': 'porzioni',
  'de-DE': 'Portionen',
  'fr-FR': 'portions',
  'en-US': 'servings',
  'pl-PL': 'porcje',
  'cs-CZ': 'porce',
};

/**
 * Verified live Italian (it-IT) numeric category IDs fetched directly from
 * `POST https://www.monsieur-cuisine.com/wp-admin/admin-ajax.php` (`action=load_recipe_post`).
 * WordPress WPML assigns distinct term IDs per language (e.g. it-IT = 261 vs de-DE = 260).
 */
export const MC_IT_CATEGORY_ID_MAP: Record<McCategory, number> = {
  'Tagliaverdure': 557,
  'Vegano': 575,
  'Vegetariano': 584,
  'Salse e condimenti': 221,
  'Zuppe & stufati': 229,
  'Insalate': 237,
  'Contorni': 245,
  'Spuntini': 253,
  'Piatti principali': 261,
  'Alimenti per bambini': 269,
  'Bevande': 277,
  'One-Pot / All-in-One': 285,
  'Dolci': 309,
  'Cuocere al forno': 317,
  'Colazione': 325,
  'Cena': 333,
  'Antipasti': 341,
  'Marmellate & gelatina': 349,
  'Cucina tedesca': 474,
  'Cucina francese': 475,
  'Cucina spagnola': 503,
  'Cucina italiana': 476,
  'Cucina polacca': 477,
};

export interface McRecipeCreationGuide {
  locale: SupportedMcLocale;
  categories: Array<{ id: number; name: string }>;
  complexityLevels: Array<{ id: number; name: string }>;
}

export function resolveMcCategoryIds(
  rawCategory: string,
  liveGuide?: McRecipeCreationGuide | null
): number[] {
  const normalized = normalizeMcCategory(rawCategory);
  const itDefaultId = MC_IT_CATEGORY_ID_MAP[normalized] ?? 261;

  if (liveGuide && liveGuide.categories.length > 0) {
    // 1. Exact case-insensitive name match against the live WordPress taxonomy for the active locale
    const needle = normalized.toLowerCase();
    const byName = liveGuide.categories.find((c) => c.name.trim().toLowerCase() === needle);
    if (byName) return [byName.id];

    // 2. If the verified it-IT ID exists in the live guide, use it directly
    const byId = liveGuide.categories.find((c) => c.id === itDefaultId);
    if (byId) return [byId.id];

    // 3. Safe fallback: pick a valid category from the live guide (avoiding HTTP 403 Invalid category)
    return [liveGuide.categories[0].id];
  }

  return [itDefaultId];
}

export function resolveMcComplexityId(
  difficulty: 'easy' | 'medium' | 'hard',
  locale: SupportedMcLocale,
  liveGuide?: McRecipeCreationGuide | null
): number {
  const staticId =
    LOCALE_COMPLEXITY_IDS[locale]?.[difficulty] ?? LOCALE_COMPLEXITY_IDS['it-IT'].easy;
  if (liveGuide && liveGuide.complexityLevels.length > 0) {
    if (liveGuide.complexityLevels.some((l) => l.id === staticId)) {
      return staticId;
    }
    const idx = difficulty === 'easy' ? 0 : difficulty === 'medium' ? 1 : 2;
    return (
      liveGuide.complexityLevels[Math.min(idx, liveGuide.complexityLevels.length - 1)]?.id ??
      staticId
    );
  }
  return staticId;
}

export interface RawMcDeviceSetting {
  order: number;
  time?: number;
  temperature?: number;
  speed?: number;
  clockwise?: boolean;
  weight?: number;
}

export type RawMcSmartMode =
  | null
  | {
      type: string;
      modeSetting: null;
      deviceSettings: [RawMcDeviceSetting];
    };

export interface MonsieurCuisineApiPayload {
  status: 'draft' | 'private-publish';
  source: 'member';
  languageLocale: SupportedMcLocale;
  deviceTypeIds: [13];
  title: string;
  description: string;
  thumbnail: {
    portraitMediaId: number | null;
    landscapeMediaId: number | null;
  };
  detailsImage: {
    portraitMediaId: number | null;
    landscapeMediaId: number | null;
  };
  complexityId: number;
  allowSocialSharing: false;
  categoryIds: number[];
  nutrients: Array<{
    name: 'calories' | 'protein' | 'carbohydrate' | 'fat';
    unit: 'kCal' | 'g';
    amount: number;
  }>;
  servingSizes: [
    {
      amount: number;
      maxServing: null;
      instruction: string;
      unit: string;
      isDefault: true;
      preparationTime: number;
      readyInTime: number;
      ingredientGroups: [
        {
          name: string;
          isDefault: true;
          order: 0;
          ingredients: Array<{
            name: string;
            isOptional: boolean;
            unit: string;
            amount: string;
            systemIngredientId: null;
            order: number;
            ingredientCategory: null;
            iconUrl: null;
          }>;
        },
      ];
      steps: Array<{
        title: string;
        description: string;
        duration: null;
        mode: RawMcSmartMode;
        videoMedia: null;
        order: number;
      }>;
      order: 0;
    },
  ];
}

export function normalizeMcLocale(locale?: string): SupportedMcLocale {
  const cleaned = (locale || 'it-IT').trim();
  if ((SUPPORTED_MC_LOCALES as readonly string[]).includes(cleaned)) {
    return cleaned as SupportedMcLocale;
  }
  const langPrefix = cleaned.split('-')[0].toLowerCase();
  const byPrefix: Record<string, SupportedMcLocale> = {
    it: 'it-IT',
    de: 'de-DE',
    fr: 'fr-FR',
    en: 'en-US',
    pl: 'pl-PL',
    cs: 'cs-CZ',
  };
  return byPrefix[langPrefix] || 'it-IT';
}

function snapToAllowedSteps(value: number, allowed: readonly number[]): number {
  let best = allowed[0];
  let bestDiff = Math.abs(value - best);
  for (const step of allowed) {
    const diff = Math.abs(value - step);
    if (diff < bestDiff) {
      best = step;
      bestDiff = diff;
    }
  }
  return best;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function truncateText(text: string, maxLen: number): string {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Converts a UI RecipeStep into the exact hardware-validated MC3.0 `mode` object
 * accepted by `POST api/v3/auth/user/recipes/`.
 */
export function buildRawSmartMode(step: RecipeStep): RawMcSmartMode {
  const duration = Math.max(0, Math.round(step.durationSec || 0));

  switch (step.program) {
    case 'prep':
      return null;

    case 'turbo': {
      const time = clampInt(duration || 3, 1, 20);
      return {
        type: 'turbo',
        modeSetting: null,
        deviceSettings: [{ order: 0, time }],
      };
    }

    case 'rosolare': {
      const temp = snapToAllowedSteps(
        step.temperatureC ?? 120,
        SMART_HEATING_TEMPERATURE_STEPS
      );
      // MC3.0 roasting mode allows 0..840s (14 min). If longer, fall back safely to manual customized.
      if (duration > 840) {
        return {
          type: 'customized',
          modeSetting: null,
          deviceSettings: [
            {
              order: 0,
              temperature: temp,
              time: clampInt(duration, 1, 5940),
              speed: 1,
              clockwise: !step.reverse,
            },
          ],
        };
      }
      return {
        type: 'roasting',
        modeSetting: null,
        deviceSettings: [
          {
            order: 0,
            temperature: temp,
            time: clampInt(duration || 180, 0, 840),
          },
        ],
      };
    }

    case 'cottura_lenta': {
      // MC3.0 slow_cooking requires 900..28800s (15..480 min) and 37..95°C.
      if (duration >= 900) {
        const temp = snapToAllowedSteps(
          step.temperatureC ?? 90,
          SMART_LOW_TEMPERATURE_STEPS
        );
        return {
          type: 'slow_cooking',
          modeSetting: null,
          deviceSettings: [
            {
              order: 0,
              temperature: temp,
              time: clampInt(duration, 900, 28800),
            },
          ],
        };
      }
      // Sub-15-min gentle simmer safely uses customized heating with reverse speed 1
      const temp = snapToAllowedSteps(
        step.temperatureC ?? 95,
        SMART_HEATING_TEMPERATURE_STEPS
      );
      return {
        type: 'customized',
        modeSetting: null,
        deviceSettings: [
          {
            order: 0,
            temperature: temp,
            time: clampInt(duration || 300, 1, 5940),
            speed: 1,
            clockwise: false,
          },
        ],
      };
    }

    case 'vapore': {
      return {
        type: 'steaming',
        modeSetting: null,
        deviceSettings: [{ order: 0, time: clampInt(duration || 900, 0, 3600) }],
      };
    }

    case 'impastare': {
      return {
        type: 'kneading_solid_dough',
        modeSetting: null,
        deviceSettings: [{ order: 0, time: clampInt(duration || 120, 45, 240) }],
      };
    }

    case 'frullare': {
      // MC3.0 puree allows 30..120s. Outside that window, use customized without heating.
      if (duration >= 30 && duration <= 120) {
        return {
          type: 'puree',
          modeSetting: null,
          deviceSettings: [{ order: 0, time: duration }],
        };
      }
      return {
        type: 'customized',
        modeSetting: null,
        deviceSettings: [
          {
            order: 0,
            temperature: 0,
            time: clampInt(duration || 30, 1, 5940),
            speed: clampInt(step.speed ?? 7, 1, 10),
            clockwise: true,
          },
        ],
      };
    }

    case 'cuocere': {
      // MC3.0 API uses customized (heated speed 1, reverse when requested) for general boiling/simmering
      const temp = snapToAllowedSteps(
        step.temperatureC ?? 100,
        SMART_HEATING_TEMPERATURE_STEPS
      );
      return {
        type: 'customized',
        modeSetting: null,
        deviceSettings: [
          {
            order: 0,
            temperature: temp,
            time: clampInt(duration || 600, 1, 5940),
            speed: 1,
            clockwise: !step.reverse,
          },
        ],
      };
    }

    case 'manual':
    default: {
      if (duration <= 0 && !step.temperatureC && !step.speed) {
        return null;
      }
      const rawTemp = step.temperatureC ?? 0;
      const temp =
        rawTemp > 0 ? snapToAllowedSteps(rawTemp, SMART_HEATING_TEMPERATURE_STEPS) : 0;
      const clockwise = !step.reverse;
      const maxSpeed = temp > 0 || !clockwise ? 3 : 10;
      const speed = clampInt(step.speed ?? 1, 0, maxSpeed);
      return {
        type: 'customized',
        modeSetting: null,
        deviceSettings: [
          {
            order: 0,
            temperature: temp,
            time: clampInt(duration || 60, 1, 5940),
            speed,
            clockwise,
          },
        ],
      };
    }
  }
}

/**
 * Applies a proposed change toggle onto a recipe's steps immutably.
 */
export function applyProposedChangeToggle(
  steps: RecipeStep[],
  change: ProposedChange,
  accepted: boolean
): RecipeStep[] {
  if (change.stepIndex === null || change.stepIndex < 0 || change.stepIndex >= steps.length) {
    return steps;
  }
  const patch = accepted ? change.proposedStepPatch : change.originalStepPatch;
  if (!patch) {
    return steps;
  }
  return steps.map((step, idx) =>
    idx === change.stepIndex
      ? {
          ...step,
          ...patch,
        }
      : step
  );
}

/**
 * Builds the exact official Monsieur Cuisine Smart (MC3.0) draft recipe payload
 * accepted by `POST https://www.monsieur-cuisine.com/proxy-api` -> `api/v3/auth/user/recipes/`.
 */
export function buildMonsieurCuisinePayload(
  recipe: ConvertedRecipe,
  options?: {
    locale?: string;
    thumbnailMediaId?: number | null;
    detailsMediaId?: number | null;
    status?: 'draft' | 'private-publish';
    liveGuide?: McRecipeCreationGuide | null;
  }
): MonsieurCuisineApiPayload {
  const locale = normalizeMcLocale(options?.locale);
  const complexityId = resolveMcComplexityId(recipe.difficulty, locale, options?.liveGuide);
  const categoryIds = resolveMcCategoryIds(recipe.category, options?.liveGuide);

  const prepTime = clampInt(recipe.prepTimeMin || 15, 1, 1440);
  const totalTime = clampInt(
    Math.max(prepTime, recipe.totalTimeMin || prepTime + (recipe.cookTimeMin || 0)),
    1,
    2880
  );

  // Full continuous text instructions (displayed as non-guided summary in MC web/app)
  const fullInstructionText = truncateText(
    recipe.steps
      .map((step, i) => {
        const bladeHint =
          step.useBladeCover && !step.instruction.toLowerCase().includes('coprilame')
            ? ' [Usa il Coprilame]'
            : '';
        const accHint = step.accessoryNote?.trim() ? ` (${step.accessoryNote.trim()})` : '';
        return `${i + 1}. ${step.instruction.trim()}${bladeHint}${accHint}`;
      })
      .join(' '),
    4000
  );

  const validIngredients = recipe.ingredients
    .filter((ing) => ing.name.trim().length > 0)
    .map((ing, index) => {
      const displayName = ing.note?.trim()
        ? `${ing.name.trim()} (${ing.note.trim()})`
        : ing.name.trim();
      const amountStr =
        ing.amount !== null && ing.amount !== undefined && Number.isFinite(ing.amount)
          ? String(ing.amount)
          : '';
      return {
        name: truncateText(displayName, 120),
        isOptional: false,
        unit: truncateText(ing.unit?.trim() || (amountStr ? 'g' : 'q.b.'), 30),
        amount: amountStr || '1',
        systemIngredientId: null,
        order: index + 1,
        ingredientCategory: null,
        iconUrl: null,
      };
    });

  // MC API requires at least 1 ingredient in ingredientGroups[0]
  if (validIngredients.length === 0) {
    validIngredients.push({
      name: 'Ingredienti come da ricetta',
      isOptional: false,
      unit: 'q.b.',
      amount: '1',
      systemIngredientId: null,
      order: 1,
      ingredientCategory: null,
      iconUrl: null,
    });
  }

  const mappedSteps = recipe.steps
    .filter((s) => s.instruction.trim().length > 0)
    .map((step, index) => {
      const mode = buildRawSmartMode(step);
      const baseInstruction = step.instruction.trim();
      const withBlade =
        step.useBladeCover && !baseInstruction.toLowerCase().includes('coprilame')
          ? `${baseInstruction} [Coprilame]`
          : baseInstruction;

      // Official MC API only allows non-empty `description` for text-only (null), scale, or turbo steps.
      const allowsDescription =
        mode === null || mode.type === 'scale' || mode.type === 'turbo';

      return {
        title: truncateText(withBlade, 80),
        description: allowsDescription ? truncateText(withBlade, 240) : '',
        duration: null,
        mode,
        videoMedia: null,
        order: index,
      };
    });

  if (mappedSteps.length === 0) {
    mappedSteps.push({
      title: 'Seguire le istruzioni della ricetta',
      description: truncateText(recipe.description || recipe.title, 240),
      duration: null,
      mode: null,
      videoMedia: null,
      order: 0,
    });
  }

  const thumbnailId = options?.thumbnailMediaId ?? null;
  const detailsId = options?.detailsMediaId ?? thumbnailId ?? null;

  return {
    status: options?.status ?? 'draft',
    source: 'member',
    languageLocale: locale,
    deviceTypeIds: [MONSIEUR_CUISINE_SMART_DEVICE_TYPE_ID],
    title: truncateText(recipe.title, 120) || 'Ricetta Monsieur Cuisine',
    description: truncateText(recipe.description || recipe.title, 2000),
    thumbnail: {
      portraitMediaId: thumbnailId,
      landscapeMediaId: thumbnailId,
    },
    detailsImage: {
      portraitMediaId: detailsId,
      landscapeMediaId: detailsId,
    },
    complexityId,
    allowSocialSharing: false,
    categoryIds,
    nutrients: [
      {
        name: 'calories',
        unit: 'kCal',
        amount: Math.max(0, Math.round(Number(recipe.nutrition.kcal) || 0)),
      },
      {
        name: 'protein',
        unit: 'g',
        amount: Math.max(0, Math.round(Number(recipe.nutrition.proteine) || 0)),
      },
      {
        name: 'carbohydrate',
        unit: 'g',
        amount: Math.max(0, Math.round(Number(recipe.nutrition.carboidrati) || 0)),
      },
      {
        name: 'fat',
        unit: 'g',
        amount: Math.max(0, Math.round(Number(recipe.nutrition.grassi) || 0)),
      },
    ],
    servingSizes: [
      {
        amount: clampInt(recipe.targetServings || 4, 1, 24),
        maxServing: null,
        instruction: fullInstructionText,
        unit: DEFAULT_SERVING_UNIT[locale],
        isDefault: true,
        preparationTime: prepTime,
        readyInTime: totalTime,
        ingredientGroups: [
          {
            name: DEFAULT_INGREDIENT_GROUP_NAME[locale],
            isDefault: true,
            order: 0,
            ingredients: validIngredients,
          },
        ],
        steps: mappedSteps,
        order: 0,
      },
    ],
  };
}
