import type {
  AppSettingsView,
  ConvertedRecipe,
  DuplicateCheckResult,
  McSessionStatus,
  StoredRecipeRecord,
} from '../shared/types';

// Held strictly in JS memory (never written to localStorage/sessionStorage)
// so auth works reliably even in cross-site preview iframes where browsers block 3P cookies.
let inMemorySessionToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function clearInMemorySession() {
  inMemorySessionToken = null;
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;

  constructor(message: string, status: number, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'MCSmartBridge');
  if (inMemorySessionToken) {
    headers.set('Authorization', `Bearer ${inMemorySessionToken}`);
  }
  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  const ct = resp.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await resp.json().catch(() => null) : null;

  if (!resp.ok) {
    if (resp.status === 401 && !url.startsWith('/api/auth/')) {
      inMemorySessionToken = null;
      unauthorizedHandler?.();
    }
    const msg =
      (data && typeof data.error === 'string' && data.error) ||
      (data && typeof data.message === 'string' && data.message) ||
      `Errore HTTP ${resp.status}`;
    throw new ApiError(msg, resp.status, data);
  }

  return data as T;
}

export const api = {
  getAuthStatus: () =>
    apiFetch<{ authenticated: boolean; needsSetup: boolean; authSource: string }>('/api/auth/status'),

  setupAdminPassword: async (password: string) => {
    const res = await apiFetch<{ ok: boolean; authenticated: boolean; token?: string }>(
      '/api/auth/setup',
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    );
    if (res.token) inMemorySessionToken = res.token;
    return res;
  },

  login: async (password: string) => {
    const res = await apiFetch<{ ok: boolean; authenticated: boolean; token?: string }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    );
    if (res.token) inMemorySessionToken = res.token;
    return res;
  },

  logout: async () => {
    try {
      return await apiFetch<{ ok: boolean }>('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      inMemorySessionToken = null;
    }
  },

  getSettings: () => apiFetch<AppSettingsView>('/api/settings'),

  updateSettings: (payload: {
    appPassword?: string;
    geminiApiKey?: string;
    mcEmail?: string;
    mcPassword?: string;
    defaultMultiplier?: number;
    mcBaseUrl?: string;
    mcLocale?: string;
  }) =>
    apiFetch<{ ok: boolean; message: string; settings: AppSettingsView }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  testAiConnection: () =>
    apiFetch<{ ok: boolean; model: string; latencyMs: number; message: string }>(
      '/api/settings/test-ai',
      { method: 'POST' }
    ),

  mcDirectLogin: (payload?: { email?: string; password?: string }) =>
    apiFetch<{ ok: boolean; status: McSessionStatus; message: string }>('/api/mc/login', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  mcVerifySession: () =>
    apiFetch<{ ok: boolean; status: McSessionStatus; userId?: string; message: string }>(
      '/api/mc/verify',
      { method: 'POST' }
    ),

  mcImportCookies: (json: string, email?: string) =>
    apiFetch<{ ok: boolean; verified?: boolean; status: McSessionStatus; message: string }>(
      '/api/mc/cookies/import',
      {
        method: 'POST',
        body: JSON.stringify({ json, email }),
      }
    ),

  exportMcCookies: async () => {
    const headers = new Headers({ 'X-Requested-With': 'MCSmartBridge' });
    if (inMemorySessionToken) {
      headers.set('Authorization', `Bearer ${inMemorySessionToken}`);
    }
    const resp = await fetch('/api/mc/cookies/export', {
      method: 'GET',
      headers,
      credentials: 'include',
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new ApiError(data?.error || 'Impossibile esportare i cookie.', resp.status, data);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mc_session_backup.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  checkDuplicate: (payload: { sourceUrl?: string | null; title?: string | null }) =>
    apiFetch<DuplicateCheckResult>('/api/recipes/check-duplicate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  convertRecipe: (payload: {
    mode: 'url' | 'text';
    url?: string;
    text?: string;
    multiplier: number;
    forceReimport?: boolean;
    coverImageUrl?: string | null;
  }) =>
    apiFetch<{
      recipe: ConvertedRecipe;
      duplicateCheck: DuplicateCheckResult;
      mcPayloadPreview: Record<string, unknown>;
    }>('/api/recipes/convert', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  rescaleRecipe: (recipe: ConvertedRecipe, multiplier: number) =>
    apiFetch<{
      recipe: ConvertedRecipe;
      mcPayloadPreview: Record<string, unknown>;
    }>('/api/recipes/rescale', {
      method: 'POST',
      body: JSON.stringify({ recipe, multiplier }),
    }),

  uploadCoverImage: (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    return apiFetch<{ ok: boolean; coverImageUrl: string }>('/api/images/upload', {
      method: 'POST',
      body: fd,
    });
  },

  approveAndUploadRecipe: (recipe: ConvertedRecipe, forceReimport: boolean) =>
    apiFetch<{
      ok: boolean;
      uploadedToCloud: boolean;
      message: string;
      record: StoredRecipeRecord;
      mcPayload: Record<string, unknown>;
    }>('/api/recipes/upload', {
      method: 'POST',
      body: JSON.stringify({ recipe, forceReimport }),
    }),

  listRecipes: () => apiFetch<{ recipes: StoredRecipeRecord[] }>('/api/recipes'),

  retryRecipeUpload: (id: number) =>
    apiFetch<{
      ok: boolean;
      uploadedToCloud: boolean;
      message: string;
      record: StoredRecipeRecord;
    }>(`/api/recipes/${id}/retry-upload`, {
      method: 'POST',
    }),

  deleteRecipe: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/recipes/${id}`, {
      method: 'DELETE',
    }),

  getDeployFiles: () =>
    apiFetch<{
      nginx: string;
      systemd: string;
      dockerCompose: string;
      dockerfile: string;
    }>('/api/deploy/files'),
};
