import React, { useCallback, useEffect, useState } from 'react';
import {
  BookMarked,
  ChefHat,
  LogOut,
  Menu,
  Server,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import type { AppSettingsView, ConvertedRecipe, StoredRecipeRecord } from './shared/types';
import { api, clearInMemorySession, setUnauthorizedHandler } from './lib/api';
import { AuthScreen } from './components/AuthScreen';
import { ConverterView } from './components/ConverterView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { DeployView } from './components/DeployView';

type NavSection = 'converter' | 'history' | 'settings' | 'deploy';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'converter', label: 'Importa e Converti', icon: Sparkles },
  { id: 'history', label: 'Storico Ricette', icon: BookMarked },
  { id: 'settings', label: 'Impostazioni .env', icon: Settings },
  { id: 'deploy', label: 'Deploy Oracle VM', icon: Server },
];

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [activeNav, setActiveNav] = useState<NavSection>('converter');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [recipes, setRecipes] = useState<StoredRecipeRecord[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<ConvertedRecipe | null>(null);

  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'info' | 'error';
  } | null>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'info' | 'error' = 'info') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.tone === 'error' ? 14000 : 7500;
    const t = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(t);
  }, [toast]);

  const loadWorkspaceData = useCallback(async () => {
    setRecipesLoading(true);
    try {
      const [settingsData, recipesData] = await Promise.all([
        api.getSettings(),
        api.listRecipes(),
      ]);
      setSettings(settingsData);
      setRecipes(recipesData.recipes);
    } catch {
      // Ignore transient load errors; views handle empty state gracefully
    } finally {
      setRecipesLoading(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const status = await api.getAuthStatus();
      setAuthenticated(status.authenticated);
      setNeedsSetup(status.needsSetup);
      if (status.authenticated) {
        await loadWorkspaceData();
      }
    } catch {
      setAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  }, [loadWorkspaceData]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearInMemorySession();
      setAuthenticated(false);
      setSettings(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeNav]);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      setAuthenticated(false);
      setNeedsSetup(false);
      setSettings(null);
      setRecipes([]);
      setEditingRecipe(null);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <p className="text-sm text-slate-500">Verifica sessione...</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <AuthScreen
        needsSetup={needsSetup}
        onAuthenticated={() => {
          setAuthenticated(true);
          setNeedsSetup(false);
          loadWorkspaceData();
        }}
      />
    );
  }

  const currentNavMeta = NAV_ITEMS.find((item) => item.id === activeNav) ?? NAV_ITEMS[0];
  const mcConnected = Boolean(settings?.mcSession?.authenticated);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-slate-200">
          <ChefHat className="w-5 h-5 text-[#166534] shrink-0" />
          <span className="font-semibold text-base tracking-tight text-slate-900 whitespace-nowrap">
            MC Smart Bridge
          </span>
        </div>

        <nav aria-label="Navigazione principale" className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveNav(item.id);
                  if (item.id !== 'converter') setEditingRecipe(null);
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full h-10 px-3 inline-flex items-center justify-between text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 text-[#166534]'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'history' && recipes.length > 0 && (
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {recipes.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3 text-xs text-slate-600">
          <div className="px-2 space-y-1">
            <div className="text-slate-400">Cloud Monsieur Cuisine</div>
            <div className="font-medium text-slate-800">
              {mcConnected ? 'Sessione attiva' : 'Modalità bozza locale'}
            </div>
            <div className="font-mono tabular-nums text-slate-500">
              Scala default: {settings?.defaultMultiplier ?? 1.5}x
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full h-9 px-3 inline-flex items-center gap-2 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Esci</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col border-r border-slate-200 z-50">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-semibold text-base text-slate-900">MC Smart Bridge</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Chiudi menu"
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav aria-label="Menu mobile" className="flex-1 p-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full h-11 px-3 inline-flex items-center gap-2.5 text-sm font-medium rounded-lg ${
                      active ? 'bg-emerald-50 text-[#166534]' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full h-11 px-3 inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <LogOut className="w-4 h-4" />
                <span>Esci</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar (3-zone contract) */}
        <header className="h-14 lg:h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Apri menu di navigazione"
              className="lg:hidden h-10 w-10 -ml-2 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
                MC Smart Bridge
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-slate-900 truncate">{currentNavMeta.label}</span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
            <span>{recipes.length} ricette in SQLite</span>
            <span aria-hidden="true">·</span>
            <span>{mcConnected ? 'Cloud MC connesso' : 'Cloud MC non connesso'}</span>
          </div>

          <div className="shrink-0">
            {activeNav !== 'converter' ? (
              <button
                type="button"
                onClick={() => {
                  setEditingRecipe(null);
                  setActiveNav('converter');
                }}
                className="h-9 px-3.5 text-xs font-medium text-white bg-[#166534] hover:bg-[#14532D] rounded-lg transition-colors whitespace-nowrap"
              >
                Nuova ricetta
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveNav('settings')}
                className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              >
                Configura .env
              </button>
            )}
          </div>
        </header>

        {/* Feedback Toast Banner */}
        {toast && (
          <div className="px-4 sm:px-8 pt-4 max-w-6xl w-full mx-auto">
            <div
              role="status"
              className={`flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm border ${
                toast.tone === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : toast.tone === 'error'
                    ? 'bg-red-50 border-red-200 text-red-900'
                    : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Chiudi notifica"
                className="text-xs font-medium opacity-70 hover:opacity-100 whitespace-nowrap"
              >
                Chiudi
              </button>
            </div>
          </div>
        )}

        {/* Viewport Workspace */}
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-6xl w-full mx-auto">
          {activeNav === 'converter' && (
            <ConverterView
              defaultMultiplier={settings?.defaultMultiplier ?? 1.5}
              initialReviewRecipe={editingRecipe}
              onClearInitialReview={() => setEditingRecipe(null)}
              onRecipeSaved={(msg, uploadedToCloud) => {
                showToast(msg, uploadedToCloud ? 'success' : 'error');
                loadWorkspaceData();
                setActiveNav('history');
              }}
            />
          )}

          {activeNav === 'history' && (
            <HistoryView
              recipes={recipes}
              loading={recipesLoading}
              onRefresh={loadWorkspaceData}
              onOpenInEditor={(recipe) => {
                setEditingRecipe(recipe);
                setActiveNav('converter');
              }}
              onGoToConverter={() => setActiveNav('converter')}
              onNotify={showToast}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              settings={settings}
              onSettingsUpdated={(next) => setSettings(next)}
              onNotify={showToast}
            />
          )}

          {activeNav === 'deploy' && <DeployView />}
        </main>
      </div>
    </div>
  );
}
