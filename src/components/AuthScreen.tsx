import React, { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';

interface AuthScreenProps {
  needsSetup: boolean;
  onAuthenticated: () => void;
}

export function AuthScreen({ needsSetup, onAuthenticated }: AuthScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = password.trim();
    if (!trimmed) {
      setError('Inserisci la password per continuare.');
      return;
    }

    if (needsSetup) {
      if (trimmed.length < 6) {
        setError('Scegli una password di almeno 6 caratteri.');
        return;
      }
      if (trimmed !== confirmPassword.trim()) {
        setError('Le due password non coincidono.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (needsSetup) {
        await api.setupAdminPassword(trimmed);
      } else {
        await api.login(trimmed);
      }
      onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Errore di connessione al server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-between px-4 py-10">
      <div className="max-w-md w-full mx-auto my-auto">
        <div className="mb-8">
          <p className="text-sm font-medium text-[#166534] mb-2">MC Smart Bridge</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            {needsSetup
              ? 'Configura la password di accesso'
              : 'Accedi al ponte Monsieur Cuisine'}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
            {needsSetup
              ? 'Primo avvio rilevato: imposta la password amministratore per proteggere il convertitore, le impostazioni .env e i cookie cloud.'
              : 'Inserisci la password configurata per accedere al convertitore AI, allo storico SQLite e alla sincronizzazione cloud.'}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5"
        >
          <div>
            <label
              htmlFor="auth-password"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              {needsSetup ? 'Nuova password amministratore' : 'Password'}
            </label>
            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsSetup ? 'Almeno 6 caratteri' : 'Inserisci password'}
                className="w-full h-11 pl-3.5 pr-11 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {needsSetup && (
            <div>
              <label
                htmlFor="auth-password-confirm"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Conferma password
              </label>
              <input
                id="auth-password-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ripeti la password"
                className="w-full h-11 px-3.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#166534]/20 focus:border-[#166534] transition-colors"
                required
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-[#166534] hover:bg-[#14532D] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            {needsSetup ? <ShieldCheck className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            <span>
              {submitting
                ? 'Verifica in corso...'
                : needsSetup
                  ? 'Imposta password ed entra'
                  : 'Accedi'}
            </span>
          </button>

          <p className="text-xs text-slate-500 leading-relaxed pt-1">
            Sessione protetta tramite cookie firmato HttpOnly. Puoi modificare la password in
            qualsiasi momento dal pannello Impostazioni .env.
          </p>
        </form>
      </div>

      <footer className="text-center text-xs text-slate-500">
        MC Smart Bridge · Self-Hosted per Silvercrest Monsieur Cuisine Smart
      </footer>
    </div>
  );
}
