import React, { useEffect, useState } from 'react';
import { Check, Copy, FolderTree, Server, Terminal } from 'lucide-react';
import { api } from '../lib/api';

type DeployTab = 'nginx' | 'systemd' | 'dockerCompose' | 'dockerfile';

const PROJECT_TREE = `mc-smart-bridge/
├── .env                          # Configurazione a caldo (modificabile da UI, mode 0600)
├── .env.example                  # Template variabili d'ambiente
├── server.ts                     # Backend Express + API + Vite SPA (porta 8000 su VM)
├── data/                         # Directory persistente (esclusa da git)
│   ├── recipes.db                # Database SQLite storico + anti-duplicati + config
│   ├── mc_session.json           # Cookie persistenti Monsieur Cuisine (mode 0600)
│   └── uploads/                  # Foto copertina ridimensionate 1200x800 JPEG
├── server/
│   ├── lib/
│   │   ├── scaling.ts            # Scala 1,5x + condimenti <=1,3x + controllo boccale 3 L
│   │   ├── dedupe.ts             # Normalizzazione URL + hash + fuzzy matching >85%
│   │   ├── envManager.ts         # Lettura/scrittura .env + hot-reload process.env
│   │   ├── mcPayload.ts          # Serializzazione payload Monsieur Cuisine Smart MC3.0
│   │   └── ssrf.ts               # Protezione URL / DNS anti-SSRF
│   └── services/
│       ├── auth.ts               # Cookie HttpOnly firmato + scrypt + CSRF guard
│       ├── db.ts                 # Prepared statements SQLite (better-sqlite3)
│       ├── geminiEngine.ts       # Motore AI @google/genai Structured Outputs
│       ├── mcClient.ts           # Login diretto MC + backup cookie + upload cloud
│       └── scraper.ts            # Estrazione Schema.org JSON-LD + resize Sharp
├── src/                          # Frontend React + Tailwind v4
└── deploy/
    ├── nginx-mc-bridge.conf      # Reverse proxy Nginx + Certbot + upload 10M
    ├── mc-bridge.service         # Unit systemd per Oracle Cloud VM (ARM64/x86_64)
    ├── docker-compose.yml        # Alternativa Docker Compose con volume ./data
    └── Dockerfile                # Immagine multi-arch ARM64 / x86_64`;

const ORACLE_COMMANDS = `# 1. Installazione su Oracle Cloud VM (Ubuntu 24.04 ARM64 / x86_64)
sudo mkdir -p /opt/mc-smart-bridge && sudo chown $USER:$USER /opt/mc-smart-bridge
cd /opt/mc-smart-bridge
npm ci && npm run build

# 2. Abilitazione servizio systemd (porta interna 127.0.0.1:8000)
sudo cp deploy/mc-bridge.service /etc/systemd/system/mc-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now mc-bridge

# 3. Configurazione Nginx + Certbot HTTPS (client_max_body_size 10M)
sudo cp deploy/nginx-mc-bridge.conf /etc/nginx/sites-available/mc-bridge.conf
sudo ln -sf /etc/nginx/sites-available/mc-bridge.conf /etc/nginx/sites-enabled/mc-bridge.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ricette.tuodominio.it`;

export function DeployView() {
  const [files, setFiles] = useState<{
    nginx: string;
    systemd: string;
    dockerCompose: string;
    dockerfile: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<DeployTab>('nginx');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDeployFiles()
      .then(setFiles)
      .catch(() => {
        setFiles(null);
      });
  }, []);

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard fallback ignored if blocked
    }
  }

  const activeContent = files ? files[activeTab] : 'Caricamento file di deploy...';

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Deploy su Oracle Cloud VM e Nginx
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Configurazioni di produzione pronte all’uso per VM Linux Oracle Cloud (Ampere ARM64 o
          x86_64) dietro reverse proxy Nginx con Certbot HTTPS e persistenza locale in{' '}
          <span className="font-mono text-xs">data/</span>.
        </p>
      </div>

      {/* Config Viewer Tabs */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
          <div className="overflow-x-auto max-w-full">
            <div
              role="tablist"
              aria-label="File di configurazione deploy"
              className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg"
            >
            {(
              [
                ['nginx', 'Nginx (HTTPS / 10M)'],
                ['systemd', 'systemd (.service)'],
                ['dockerCompose', 'docker-compose.yml'],
                ['dockerfile', 'Dockerfile'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeTab === id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => copyText(activeTab, activeContent)}
            className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-md whitespace-nowrap"
          >
            {copiedKey === activeTab ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#166534]" />
                <span>Copiato</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copia file</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-5 text-xs font-mono text-slate-800 bg-white overflow-x-auto leading-relaxed">
          {activeContent}
        </pre>
      </section>

      {/* Split: Project Structure & Setup Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-slate-500" />
              <span>Struttura cartelle progetto</span>
            </h2>
            <button
              type="button"
              onClick={() => copyText('tree', PROJECT_TREE)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              {copiedKey === 'tree' ? 'Copiato' : 'Copia'}
            </button>
          </div>
          <pre className="text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 overflow-x-auto leading-relaxed flex-1">
            {PROJECT_TREE}
          </pre>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-500" />
                <span>Comandi rapidi Oracle Cloud VM</span>
              </h2>
              <button
                type="button"
                onClick={() => copyText('cmds', ORACLE_COMMANDS)}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                {copiedKey === 'cmds' ? 'Copiato' : 'Copia'}
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4 overflow-x-auto leading-relaxed">
              {ORACLE_COMMANDS}
            </pre>
          </div>

          <div className="border-t border-slate-200 pt-3 text-xs text-slate-600 flex items-start gap-2.5">
            <Server className="w-4 h-4 text-[#166534] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Ricorda di aprire le porte <span className="font-mono">80</span> e{' '}
              <span className="font-mono">443</span> nella Security List / NSG della VCN Oracle
              Cloud (e su <span className="font-mono">ufw</span>/<span className="font-mono">iptables</span>
              ), mantenendo la porta <span className="font-mono">8000</span> legata solo a{' '}
              <span className="font-mono">127.0.0.1</span>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
