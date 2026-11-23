import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Upload,
  Zap,
} from 'lucide-react';
import type { AppSettingsView } from '../shared/types';
import { api } from '../lib/api';

interface SettingsViewProps {
  settings: AppSettingsView | null;
  onSettingsUpdated: (next: AppSettingsView) => void;
  onNotify: (message: string, tone: 'success' | 'info' | 'error') => void;
}

export function SettingsView({ settings, onSettingsUpdated, onNotify }: SettingsViewProps) {
  const [appPassword, setAppPassword] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [mcEmail, setMcEmail] = useState(settings?.mcEmail || '');
  const [mcPassword, setMcPassword] = useState('');
  const [defaultMultiplier, setDefaultMultiplier] = useState(
    String(settings?.defaultMultiplier ?? 1.5)
  );
  const [mcBaseUrl, setMcBaseUrl] = useState(
    settings?.mcBaseUrl || 'https://www.monsieur-cuisine.com'
  );
  const [mcLocale, setMcLocale] = useState(settings?.mcLocale || 'it-IT');

  const [reveal, setReveal] = useState({
    appPassword: false,
    geminiApiKey: false,
    mcPassword: false,
  });

  const [savingEnv, setSavingEnv] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiResult, setAiResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loggingInMc, setLoggingInMc] = useState(false);
  const [verifyingMc, setVerifyingMc] = useState(false);
  const [mcLoginFeedback, setMcLoginFeedback] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  const [cookieJson, setCookieJson] = useState('');
  const [importingCookies, setImportingCookies] = useState(false);
  const cookieFileRef = useRef<HTMLInputElement | null>(null);

  async function handleSaveEnv(e: React.FormEvent) {
    e.preventDefault();
    setSavingEnv(true);
    try {
      const res = await api.updateSettings({
        appPassword: appPassword.trim() || undefined,
        geminiApiKey: geminiApiKey.trim() || undefined,
        mcEmail: mcEmail.trim(),
        mcPassword: mcPassword.trim() || undefined,
        defaultMultiplier: Number(defaultMultiplier),
        mcBaseUrl: mcBaseUrl.trim(),
        mcLocale: mcLocale.trim(),
      });
      onSettingsUpdated(res.settings);
      // Clear sensitive write-only inputs after persisting to .env
      setAppPassword('');
      setGeminiApiKey('');
      setMcPassword('');
      onNotify(res.message, 'success');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Errore nel salvataggio .env.', 'error');
    } finally {
      setSavingEnv(false);
    }
  }

  async function handleTestAi() {
    setTestingAi(true);
    setAiResult(null);
    try {
      const res = await api.testAiConnection();
      setAiResult({ ok: res.ok, message: res.message });
    } catch (err) {
      setAiResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Test connessione AI fallito.',
      });
    } finally {
      setTestingAi(false);
    }
  }

  async function handleForceMcLogin() {
    setLoggingInMc(true);
    setMcLoginFeedback(null);
    try {
      const res = await api.mcDirectLogin({
        email: mcEmail.trim() || undefined,
        password: mcPassword.trim() || undefined,
      });
      setMcLoginFeedback({ ok: res.ok, message: res.message });
      const refreshed = await api.getSettings();
      onSettingsUpdated(refreshed);
    } catch (err) {
      setMcLoginFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Login Monsieur Cuisine non riuscito.',
      });
      const refreshed = await api.getSettings().catch(() => null);
      if (refreshed) onSettingsUpdated(refreshed);
    } finally {
      setLoggingInMc(false);
    }
  }

  async function handleVerifyMcSession() {
    setVerifyingMc(true);
    setMcLoginFeedback(null);
    try {
      const res = await api.mcVerifySession();
      setMcLoginFeedback({ ok: res.ok, message: res.message });
      const refreshed = await api.getSettings();
      onSettingsUpdated(refreshed);
    } catch (err) {
      setMcLoginFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Verifica sessione Monsieur Cuisine fallita.',
      });
      const refreshed = await api.getSettings().catch(() => null);
      if (refreshed) onSettingsUpdated(refreshed);
    } finally {
      setVerifyingMc(false);
    }
  }

  async function handleImportCookies(e: React.FormEvent) {
    e.preventDefault();
    if (!cookieJson.trim()) {
      onNotify('Incolla i cookie (JSON o stringa header Cookie) o carica un file prima di importare.', 'error');
      return;
    }
    setImportingCookies(true);
    try {
      const res = await api.mcImportCookies(cookieJson, mcEmail.trim() || undefined);
      setCookieJson('');
      setMcLoginFeedback({ ok: res.ok, message: res.message });
      const refreshed = await api.getSettings();
      onSettingsUpdated(refreshed);
      onNotify(res.message, res.ok ? 'success' : 'error');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Errore importazione cookie.', 'error');
    } finally {
      setImportingCookies(false);
    }
  }

  function handleCookieFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCookieJson(reader.result);
      }
    };
    reader.readAsText(file);
    if (cookieFileRef.current) cookieFileRef.current.value = '';
  }

  const mcSession = settings?.mcSession;
  const sessionLabel = !mcSession || mcSession.cookieCount === 0
    ? 'Non connessa'
    : mcSession.expired
      ? 'Scaduta'
      : 'Attiva';

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Impostazioni e Configurazione Online (.env)
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Aggiorna il file <span className="font-mono text-xs">.env</span> su disco con ricaricamento
          a caldo in memoria (nessun riavvio SSH richiesto) e gestisci la sessione persistente di{' '}
          <span className="font-mono text-xs">monsieur-cuisine.com</span>.
        </p>
      </div>

      {/* Section 1: Online .env Form */}
      <form
        onSubmit={handleSaveEnv}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Variabili d’ambiente (.env)</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              I campi segreti sono write-only: lasciali vuoti per mantenere i valori già salvati sul
              server.
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestAi}
            disabled={testingAi}
            className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            {testingAi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5 text-[#166534]" />
            )}
            <span>{testingAi ? 'Verifica AI...' : 'Testa connessione AI'}</span>
          </button>
        </div>

        {aiResult && (
          <div
            role="status"
            className={`text-xs rounded-lg px-4 py-3 border ${
              aiResult.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            {aiResult.message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* APP_PASSWORD */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="env-app-pass" className="text-xs font-medium text-slate-700">
                APP_PASSWORD (Login web)
              </label>
              <span className="text-xs text-slate-500">
                {settings?.hasAppPassword ? 'Configurata' : 'Non impostata'}
              </span>
            </div>
            <div className="relative">
              <input
                id="env-app-pass"
                type={reveal.appPassword ? 'text' : 'password'}
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="Lascia vuoto per mantenere attuale"
                className="w-full h-10 pl-3 pr-10 text-sm text-slate-900 border border-slate-300 rounded-lg focus:border-[#166534]"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => ({ ...r, appPassword: !r.appPassword }))}
                aria-label={reveal.appPassword ? 'Nascondi APP_PASSWORD' : 'Mostra APP_PASSWORD'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-800"
              >
                {reveal.appPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* GEMINI_API_KEY */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="env-gemini-key" className="text-xs font-medium text-slate-700">
                GEMINI_API_KEY (Override .env self-hosted)
              </label>
              <span
                className={`text-xs font-medium ${
                  settings?.hasGeminiKey ? 'text-[#166534]' : 'text-amber-700'
                }`}
              >
                {settings?.hasGeminiKey ? 'Attiva lato server' : 'Mancante'}
              </span>
            </div>
            <div className="relative">
              <input
                id="env-gemini-key"
                type={reveal.geminiApiKey ? 'text' : 'password'}
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Lascia vuoto per mantenere attuale"
                className="w-full h-10 pl-3 pr-10 text-sm font-mono text-slate-900 border border-slate-300 rounded-lg focus:border-[#166534]"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => ({ ...r, geminiApiKey: !r.geminiApiKey }))}
                aria-label={
                  reveal.geminiApiKey ? 'Nascondi GEMINI_API_KEY' : 'Mostra GEMINI_API_KEY'
                }
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-800"
              >
                {reveal.geminiApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* MC_EMAIL */}
          <div>
            <label htmlFor="env-mc-email" className="block text-xs font-medium text-slate-700 mb-1.5">
              MC_EMAIL (Account monsieur-cuisine.com)
            </label>
            <input
              id="env-mc-email"
              type="email"
              value={mcEmail}
              onChange={(e) => setMcEmail(e.target.value)}
              placeholder="nome@esempio.it"
              className="w-full h-10 px-3 text-sm text-slate-900 border border-slate-300 rounded-lg focus:border-[#166534]"
            />
          </div>

          {/* MC_PASSWORD */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="env-mc-pass" className="text-xs font-medium text-slate-700">
                MC_PASSWORD (Password monsieur-cuisine.com)
              </label>
              <span className="text-xs text-slate-500">
                {settings?.hasMcPassword ? 'Salvata' : 'Non impostata'}
              </span>
            </div>
            <div className="relative">
              <input
                id="env-mc-pass"
                type={reveal.mcPassword ? 'text' : 'password'}
                value={mcPassword}
                onChange={(e) => setMcPassword(e.target.value)}
                placeholder="Lascia vuoto per mantenere attuale"
                className="w-full h-10 pl-3 pr-10 text-sm text-slate-900 border border-slate-300 rounded-lg focus:border-[#166534]"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => ({ ...r, mcPassword: !r.mcPassword }))}
                aria-label={reveal.mcPassword ? 'Nascondi MC_PASSWORD' : 'Mostra MC_PASSWORD'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-slate-500 hover:text-slate-800"
              >
                {reveal.mcPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* DEFAULT_MULTIPLIER */}
          <div>
            <label
              htmlFor="env-multiplier"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              DEFAULT_MULTIPLIER (Target porzioni)
            </label>
            <input
              id="env-multiplier"
              type="number"
              step="0.05"
              min="0.5"
              max="3.0"
              value={defaultMultiplier}
              onChange={(e) => setDefaultMultiplier(e.target.value)}
              className="w-full h-10 px-3 text-sm font-mono tabular-nums text-slate-900 border border-slate-300 rounded-lg focus:border-[#166534]"
            />
          </div>

          {/* MC_BASE_URL & LOCALE */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <label htmlFor="env-mc-url" className="block text-xs font-medium text-slate-700 mb-1.5">
                MC_BASE_URL
              </label>
              <input
                id="env-mc-url"
                type="url"
                value={mcBaseUrl}
                onChange={(e) => setMcBaseUrl(e.target.value)}
                className="w-full h-10 px-3 text-xs font-mono text-slate-900 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label
                htmlFor="env-mc-locale"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Locale
              </label>
              <select
                id="env-mc-locale"
                value={mcLocale}
                onChange={(e) => setMcLocale(e.target.value)}
                className="w-full h-10 px-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg"
              >
                <option value="it-IT">it-IT</option>
                <option value="de-DE">de-DE</option>
                <option value="fr-FR">fr-FR</option>
                <option value="en-US">en-US</option>
                <option value="pl-PL">pl-PL</option>
                <option value="cs-CZ">cs-CZ</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end pt-2 border-t border-slate-100">
          <button
            type="submit"
            disabled={savingEnv}
            className="h-10 px-5 inline-flex items-center gap-2 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span>{savingEnv ? 'Salvataggio...' : 'Salva .env e ricarica a caldo'}</span>
          </button>
        </div>
      </form>

      {/* Section 2: Direct Monsieur Cuisine Login & Persistent Cookie Backup */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Sessione Cloud Monsieur Cuisine e Backup Cookie
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              I cookie vengono salvati su disco in{' '}
              <span className="font-mono">data/mc_session.json</span> (permessi 0600) per
              sopravvivere ai riavvii della VM Oracle Cloud.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleForceMcLogin}
              disabled={loggingInMc}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loggingInMc ? 'animate-spin' : ''}`} />
              <span>{loggingInMc ? 'Accesso in corso...' : 'Forza Rinnovo Login MC'}</span>
            </button>

            <button
              type="button"
              onClick={handleVerifyMcSession}
              disabled={verifyingMc}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className={`w-3.5 h-3.5 text-[#166534] ${verifyingMc ? 'animate-pulse' : ''}`} />
              <span>{verifyingMc ? 'Verifica...' : 'Testa sessione MC'}</span>
            </button>

            <button
              type="button"
              onClick={async () => {
                if (!mcSession || mcSession.cookieCount === 0) {
                  onNotify('Nessun cookie salvato da esportare.', 'info');
                  return;
                }
                try {
                  await api.exportMcCookies();
                } catch (err) {
                  onNotify(
                    err instanceof Error ? err.message : 'Errore durante l’esportazione cookie.',
                    'error'
                  );
                }
              }}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Esporta Cookie JSON</span>
            </button>
          </div>
        </div>

        {/* Clean Unboxed Status Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2 text-sm">
          <div>
            <div className="text-xs text-slate-500">Stato sessione</div>
            <div
              className={`font-semibold mt-0.5 flex items-center gap-1.5 ${
                sessionLabel === 'Attiva'
                  ? 'text-[#166534]'
                  : sessionLabel === 'Scaduta'
                    ? 'text-red-700'
                    : 'text-slate-700'
              }`}
            >
              {sessionLabel === 'Attiva' && <CheckCircle2 className="w-4 h-4" />}
              <span>{sessionLabel}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Cookie salvati</div>
            <div className="font-mono font-medium text-slate-900 tabular-nums mt-0.5">
              {mcSession?.cookieCount ?? 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Origine</div>
            <div className="font-medium text-slate-800 mt-0.5">
              {mcSession?.source === 'direct_login'
                ? 'Login diretto'
                : mcSession?.source === 'imported_json'
                  ? 'Backup JSON'
                  : 'Nessuna'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Scadenza stimata</div>
            <div className="font-mono text-xs text-slate-700 tabular-nums mt-1">
              {mcSession?.expiresAt
                ? new Date(mcSession.expiresAt).toLocaleDateString('it-IT')
                : '—'}
            </div>
          </div>
        </div>

        {(mcLoginFeedback || mcSession?.lastError) && (
          <div
            role="status"
            className={`text-xs rounded-lg px-4 py-3 border leading-relaxed ${
              mcLoginFeedback?.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            {mcLoginFeedback ? mcLoginFeedback.message : mcSession?.lastError}
          </div>
        )}

        {/* Cookie JSON or Raw Header Import */}
        <form onSubmit={handleImportCookies} className="pt-4 border-t border-slate-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-slate-500" />
                <span>Importa Cookie di sessione (JSON o stringa Header Cookie)</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Se Lidl Plus blocca il login automatico dal server (anti-bot Akamai/2FA), accedi a{' '}
                <span className="font-mono">www.monsieur-cuisine.com</span> dal tuo browser, esporta
                i cookie con Cookie-Editor (JSON) oppure copia l’header{' '}
                <span className="font-mono">Cookie</span> da DevTools → Network (devono includere{' '}
                <span className="font-mono">wordpress_logged_in_*</span> e{' '}
                <span className="font-mono">lidl_sso_id_token</span>).
              </p>
            </div>

            <div>
              <input
                ref={cookieFileRef}
                type="file"
                accept="application/json,.json,.txt"
                onChange={handleCookieFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => cookieFileRef.current?.click()}
                className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-md whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Carica file .json</span>
              </button>
            </div>
          </div>

          <label htmlFor="cookie-json-input" className="sr-only">
            Cookie di sessione Monsieur Cuisine (JSON o stringa Cookie)
          </label>
          <textarea
            id="cookie-json-input"
            rows={4}
            value={cookieJson}
            onChange={(e) => setCookieJson(e.target.value)}
            placeholder='Incolla JSON da Cookie-Editor ([{"name":"wordpress_logged_in_...","value":"..."}]) oppure stringa header: wordpress_logged_in_...=...; lidl_sso_id_token=...'
            className="w-full p-3 text-xs font-mono text-slate-800 border border-slate-300 rounded-lg focus:outline-none focus:border-[#166534]"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={importingCookies}
              className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
            >
              <span>
                {importingCookies ? 'Importazione e verifica...' : 'Salva e verifica Cookie MC'}
              </span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
