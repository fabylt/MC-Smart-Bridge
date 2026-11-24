rincipali
Importazione da URL o testo libero: estrae automaticamente dati strutturati (JSON-LD, OpenGraph, DOM) da blog di cucina, GialloZafferano, ricettari Bimby, ZauberMix, ecc., con protezione SSRF sugli URL e download automatico della foto di copertina.
Motore di conversione AI (Google Gemini Structured Outputs):
Riproporzionamento intelligente (default 1.5x): porta ricette da 4 porzioni a 5 porzioni abbondanti, applicando una scala non lineare (1.2x–1.3x) a sale, spezie, peperoncino, aglio, zucchero e olio del soffritto, con arrotondamenti pratici ai 5/10 g e uova intere.
Controllo capienza boccale (max 3,0 L): stima volume, grammi di riso/pasta secca (limite 500 g) e massa verdure/liquidi (limite 1,4 kg) con avvisi immediati e adeguamento dei tempi di cottura.
Ottimizzazione meccanica anti-sfaldamento: propone la sostituzione della Velocità 1 continua con i programmi automatici nativi del Monsieur Cuisine Smart (Rosolare, Cottura lenta, Cottura a vapore, Impastare, Frullare, Turbo) e segnala l'uso del Coprilame e della rotazione Antiorario.
Valori nutrizionali e 23 categorie ufficiali Italia: calcola kcal, proteine, carboidrati e grassi per porzione e mappa le categorie ufficiali di monsieur-cuisine.com Italia sincronizzandone dinamicamente gli ID tramite load_recipe_post.
Revisione Human-in-the-Loop: anteprima modificabile di ingredienti, passaggi, programmi, moltiplicatore, nutrizione, foto (upload personalizzato fino a 10 MB ridimensionato automaticamente a 1200×800 JPEG) e accettazione/rifiuto puntuale di ogni modifica proposta dall'AI.
Controllo anti-duplicati (SQLite + Cloud): verifica sia in locale (data/recipes.db su URL normalizzato e titolo fuzzy >85%) sia sulle ricette esistenti nel proprio account cloud Monsieur Cuisine, con flag opzionale "Forza re-importazione".
Caricamento diretto sul cloud Monsieur Cuisine Smart: integra il gateway /proxy-api di monsieur-cuisine.com (POST api/v3/auth/user/recipes/ + upload media in 3 step su api/v1/media/image/upload-url), salvando le ricette come bozze pronte alla sincronizzazione sullo schermo del robot.
Pannello Impostazioni .env online: consente di aggiornare le variabili d'ambiente dall'interfaccia web con ricarica a caldo in memoria (senza riavvio SSH), testare la connessione Gemini AI, verificare la sessione MC e gestire import/export dei cookie.
Stack tecnologico
Backend: Node.js 22+, TypeScript, Express, better-sqlite3, sharp, cheerio, multer, @google/genai
Frontend: React 19, Vite, Tailwind CSS v4, Lucide Icons
Database & Persistenza: SQLite locale (data/recipes.db), sessione cookie protetta (data/mc_session.json), immagini ottimizzate (data/uploads/)
Struttura del progetto
Text
.
├── server.ts                  # Entry point Express + Vite middleware / static serving
├── server/
│   ├── lib/                   # Logica pura e unit test (scaling, dedupe, mcPayload, envManager, ssrf)
│   └── services/              # DB SQLite, auth sessioni, scraper, Gemini AI engine, client MC /proxy-api
├── src/
│   ├── App.tsx                # Shell applicativa e navigazione
│   ├── components/            # AuthScreen, ConverterView, RecipeReviewPanel, HistoryView, SettingsView, DeployView
│   ├── lib/                   # Client API frontend e ricette di esempio
│   └── shared/types.ts        # Tipi condivisi, programmi MC Smart e 23 categorie ufficiali IT
├── deploy/
│   ├── nginx-mc-bridge.conf   # Configurazione Nginx reverse proxy (pronta per Certbot)
│   ├── mc-bridge.service      # Unit file systemd per Oracle Cloud VM
│   ├── docker-compose.yml     # Alternativa Docker Compose multi-arch
│   └── Dockerfile             # Immagine multi-arch (linux/arm64 & linux/amd64)
└── data/                      # Creata a runtime: recipes.db, mc_session.json, uploads/
Avvio in locale
Prerequisiti
Node.js 20+ (consigliato 22 LTS)
Una chiave API Google Gemini (GEMINI_API_KEY)
Installazione e avvio
Bash
npm install
cp .env.example .env
Compila .env (oppure configuralo direttamente dall'interfaccia web dopo il primo accesso):
Env
PORT=3000
APP_PASSWORD=la-tua-password-sicura
GEMINI_API_KEY=la-tua-chiave-gemini
MC_EMAIL=tuo-account@esempio.it
MC_PASSWORD=la-tua-password-lidl
DEFAULT_MULTIPLIER=1.5
MC_BASE_URL=https://www.monsieur-cuisine.com
MC_LOCALE=it-IT
Avvio in sviluppo:
Bash
npm run dev
Build di produzione e avvio:
Bash
npm run build
NODE_ENV=production npm start
Test e controlli
Bash
npm test       # Esegue la suite di unit test (node:test via tsx)
npm run lint   # Controllo tipi TypeScript (tsc --noEmit)
Connessione al cloud Monsieur Cuisine (monsieur-cuisine.com)
Accedi all'app web e apri Impostazioni .env.
Inserisci MC_EMAIL e MC_PASSWORD e salva il .env.
Prova il pulsante Forza Rinnovo Login MC.
Se accounts.lidl.com blocca il login automatico dal server (protezione anti-bot Akamai o verifica 2FA/CAPTCHA tipica sugli IP datacenter):
Accedi a https://www.monsieur-cuisine.com dal tuo browser.
Esporta i cookie del sito con Cookie-Editor → Export JSON oppure copia l'header Cookie da DevTools → Network (devono essere presenti wordpress_logged_in_* e lidl_sso_id_token).
Incolla il contenuto in Importa Cookie di sessione e clicca Salva e verifica Cookie MC.
I cookie vengono salvati in data/mc_session.json con permessi 0600 (sopravvivono ai riavvii della VM) e possono essere esportati/reimportati come backup JSON.
Deploy su Oracle Cloud VM (ARM64 / x86_64) + Nginx
Opzione A: Servizio systemd (consigliata per leggerezza)
Copia il progetto in /opt/mc-smart-bridge, installa le dipendenze e compila il frontend:
Bash
cd /opt/mc-smart-bridge
npm ci
npm run build
cp .env.example .env
Modifica .env impostando PORT=8000 e le tue credenziali.
Installa e avvia il servizio systemd:
Bash
sudo cp deploy/mc-bridge.service /etc/systemd/system/mc-bridge.service
sudo systemctl daemon-reload
sudo systemctl enable --now mc-bridge
sudo journalctl -u mc-bridge -f
Opzione B: Docker Compose (multi-arch ARM64 / x86_64)
Bash
cp .env.example .env
docker compose -f deploy/docker-compose.yml up -d --build
Il container espone l'app solo su 127.0.0.1:8000 e monta ./data e ./.env come volumi persistenti.
Configurazione Nginx + HTTPS (Certbot)
Copia il file Nginx fornito e sostituisci ricette.tuodominio.it con il tuo dominio:
Bash
sudo cp deploy/nginx-mc-bridge.conf /etc/nginx/sites-available/mc-bridge.conf
sudo nano /etc/nginx/sites-available/mc-bridge.conf
sudo ln -s /etc/nginx/sites-available/mc-bridge.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
Attiva HTTPS con Let's Encrypt:
Bash
sudo certbot --nginx -d ricette.tuodominio.it
La configurazione Nginx include già client_max_body_size 10M;, inoltro degli header X-Forwarded-For / X-Forwarded-Proto / X-Forwarded-Host, timeout estesi per le conversioni AI e blocco dell'accesso ai file nascosti.
Sicurezza
Interfaccia e API protette da login con password (hash scrypt) e sessione firmata (HttpOnly; Secure su HTTPS + supporto Bearer in memoria).
File .env e data/mc_session.json scritti su disco con permessi restrittivi (0600). Non fare commit di .env né della directory data/.
Protezione SSRF sullo scraping degli URL esterni (blocco schemi non HTTP/HTTPS e indirizzi IP privati/loopback/metadata).
Query SQLite parametrizzate e upload immagini validati/ricodificati lato server tramite sharp.
Riferimenti
L'integrazione verso le API non ufficiali di monsieur-cuisine.com (/proxy-api, api/v3/auth/user/recipes/, upload media presigned e catalogo load_recipe_post) prende ispirazione dai progetti open-source:
gerkensm/smart-recipe
pgreda/Unofficial-Monsieur-Cuisine-MCP
