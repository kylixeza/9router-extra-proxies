# 9Router Extra Proxies

Local 3-layer HTTP proxy sitting in front of [9router](http://127.0.0.1:20128) (`:20128`) with role-based sub-agent orchestration, context shaping, resilient connection handling, PostgreSQL request logging, and per-layer web dashboards.

## Architecture

```text
Agent (IDE / CLI)
  │
  ▼
:20131  orchestration_layer   Role routing (/orch-plan + [[ORCH ...]] markers), roster injection, /orch dashboard
  │
  ▼
:20130  context_layer         Tool/skill keyword gating, lossless compaction & disk spill, token budget alerts, Valiant dashboard
  │
  ▼
:20129  connection_layer      Forced model rewrite, retries, model fallback, short POST dedup, secret redaction, Leon dashboard
  │
  ▼
:20128  9router               Upstream model router
  │
  ├──▶ Model A (e.g. Claude / Opus / Sonnet)
  ├──▶ Model B (e.g. GPT / Codex)
  └──▶ Model C (e.g. Gemini / Qwen / DeepSeek)
```

### Components

| Path | Purpose |
| :--- | :--- |
| [9router-proxy.js](9router-proxy.js) | Single-process entrypoint starting `connection_layer`, `context_layer`, and `orchestration_layer` |
| [orchestration_layer/](orchestration_layer) | Request detector, role-based router (`orchestrator`, `worker`, `fixer`), capability adapter, `<orch-roster>` injector, and `/orch` dashboard (incl. Symphony Monitor) |
| [context_layer/](context_layer) | Keyword-based MCP tool/skill gating, tool output dedup/offload/spill, token calibration, macOS high-token confirmation dialog, and Valiant dashboard (`/dashboard`) |
| [connection_layer/](connection_layer) | Keep-alive upstream forwarding, retry/fallback chains, request coalescing/dedup, secret redaction on logs, and Leon dashboard (`/dashboard`) |
| [storage_layer/](storage_layer) | PostgreSQL schema (`proxy_logs`, `instructions`, `orch_models`, `orch_settings`, `orch_calls`), backfill script, and project detection |

## Prerequisites

- **Node.js** `>= 22.5` (uses built-in `node:sqlite` for optional read-only API key lookup from `~/.9router/db/data.sqlite`, and `process.loadEnvFile` if `.env` is present)
- **9router** running on `http://127.0.0.1:20128` (or set `TARGET_URL` / `ORCH_9ROUTER_URL`)
- **PostgreSQL** (optional, enabled by default at `postgresql://localhost:5432/9router_proxy`; set `LOG_TO_PG=false` to run without Postgres)

## Quick Start

```bash
npm install
node 9router-proxy.js
```

Point your IDE/client OpenAI base URL to `http://127.0.0.1:20131` (full 3-layer pipeline) or directly to `:20130` (context + connection) / `:20129` (connection only).

To run layers standalone:

```bash
node connection_layer/server.js
node context_layer/server.js
node orchestration_layer/server.js
```

### Configuration via `.env` (Optional)

No `.env` file is required if local PostgreSQL accepts `postgresql://localhost:5432/9router_proxy` without credentials.
If Postgres needs credentials, custom DB URL, or you want to disable PG / set layer overrides, copy [.env.example](.env.example) to `.env` (gitignored):

```bash
cp .env.example .env
```

Example `.env`:

```dotenv
# PostgreSQL (set LOG_TO_PG=false to run without Postgres)
DATABASE_URL=postgresql://user:password@localhost:5432/9router_proxy
LOG_TO_PG=true
PG_AUTOMIGRATE=true

# Optional overrides if defaults do not match your setup:
# TARGET_URL=http://127.0.0.1:20128
# ORCH_9ROUTER_URL=http://127.0.0.1:20128
# ORCH_9ROUTER_API_KEY=your-9router-key
```

`storage_layer/config.js` loads `.env` automatically on startup (`9router-proxy.js` or `connection_layer/server.js`); shell environment variables take precedence.

### Run on Startup (macOS & Windows)

#### macOS (`launchd`)

Create `~/Library/LaunchAgents/com.local.9routerproxy.plist` (replace `<NODE_PATH>` from `which node` and `<REPO_PATH>` with your clone path):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.local.9routerproxy</string>
  <key>ProgramArguments</key>
  <array>
    <string><NODE_PATH></string>
    <string><REPO_PATH>/9router-proxy.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string><REPO_PATH>/9router-proxy.log</string>
  <key>StandardErrorPath</key><string><REPO_PATH>/9router-proxy.err</string>
</dict>
</plist>
```

Load and start immediately:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.9routerproxy.plist
```

Stop / reload:

```bash
launchctl bootout gui/$(id -u)/com.local.9routerproxy
launchctl kickstart -k gui/$(id -u)/com.local.9routerproxy
```

#### Windows (Task Scheduler)

Run in PowerShell or `cmd` (replace `<REPO_PATH>`, e.g. `C:\Users\you\.config\9router-proxy`):

```cmd
schtasks /Create /TN "9router-proxy" /SC ONLOGON /RL HIGHEST /TR "cmd /c cd /d \"<REPO_PATH>\" && node 9router-proxy.js >> 9router-proxy.log 2>> 9router-proxy.err" /F
schtasks /Run /TN "9router-proxy"
```

Stop / delete:

```cmd
schtasks /End /TN "9router-proxy"
schtasks /Delete /TN "9router-proxy" /F
```

### Dashboards & Health Endpoints

| Layer | Dashboard | Health / Stats |
| :--- | :--- | :--- |
| Orchestration (`:20131`) | `http://127.0.0.1:20131/orch` | `GET /orch/api/health`, `GET /orch/roster`, `GET /orch/api/live` |
| Context (`:20130`, Valiant) | `http://127.0.0.1:20130/dashboard` | `GET /context-health`, `GET /context-stats` |
| Connection (`:20129`, Leon) | `http://127.0.0.1:20129/dashboard` | `GET /health`, `GET /stats` |

## Environment Variables

### Connection Layer (`:20129`)
- `PORT` (`20129`)
- `TARGET_URL` (`http://127.0.0.1:20128`)
- `MAX_RETRIES` (`2`), `TTFB_TIMEOUT_MS` (`300000`)
- `DEDUP_TTL_MS` (`8000`), `DEDUP_MAX_ENTRIES` (`20`), `DEDUP_DETERMINISTIC_ONLY` (`false`)
- `MODEL_ALIASES`, `MODEL_FALLBACKS`, `REQUEST_DEFAULTS`, `DROP_PARAMS` (JSON strings)
- `LOG_DIR` (`./logs`), `LOG_KEEP` (`50`), `LOG_BODIES` (`true`)

### Orchestration Layer (`:20131`)
- `ORCH_PORT` (`20131`)
- `ORCH_UPSTREAM` (`http://127.0.0.1:20130`)
- `ORCH_9ROUTER_URL` (`http://127.0.0.1:20128`)
- `ORCH_9ROUTER_API_KEY` (optional; falls back to incoming `Authorization` header or active key in `ORCH_9ROUTER_SQLITE`)
- `ORCH_9ROUTER_SQLITE` (`~/.9router/db/data.sqlite`)

### Storage Layer (PostgreSQL)
- `DATABASE_URL` (`postgresql://localhost:5432/9router_proxy`)
- `LOG_TO_PG` (`true`)
- `PG_AUTOMIGRATE` (`true`)

## Tests

```bash
npm test
```

Runs `db-sync.test.js`, `admin-api.test.js`, and `pipeline.test.js` against ephemeral mock servers (`pipeline.test.js` runs hermetically with `LOG_TO_PG=false`; `db-sync.test.js` also verifies PostgreSQL table migration if `LOG_TO_PG` is enabled).
