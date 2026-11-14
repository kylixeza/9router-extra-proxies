# 9Router Extra Proxies — Responses compaction (context layer)

## Baseline (T0.1)
- Fixture: `context_layer/fixtures/responses-sample.json` = `proxy_logs` id `471adbe419`
  (`POST /v1/responses`, `muse/muse-spark-1.3`, `stream=true`, `n_input=199`, `n_tools=63`).
- Before change: `shapeRequest` left `body.input` byte-identical (F1 confirmed),
  `estTokens=148994`, `rawTokens=153031`.
- After hook: `estTokens=118212` (raw 153031), `input` 549177→261203 chars,
  `offloaded=5`, `imagesRemoved=1`, `bytesSaved=110793`. Order + `call_id`s intact,
  `function_call` untouched, tail protected.
- Prompt-cache note: prefix stability holds for suffix appends (T4.4). Shrink/reorder
  of history = at most one cache miss.

## Env
- `CTX_PORT` (default `20130`), `CTX_TARGET` (default `http://127.0.0.1:20129`),
  `CTX_RESPONSES` = `on` | `dry` | `off` (default `on`).
- Alerts for Responses stay OFF: `alertOnResponses=false` until T1.1–T1.3 live-verified.

## Whitelist (TRIM)
Edit `TRIM_TOOLS` / `FIGMA_TRIM_SUFFIX` at top of `context_layer/responses_compact.js`.
Default-deny: unknown tool = PROTECT. Shell = quote-aware split, allowlist per
segment; `git status|diff|log|show` only after later successful `git commit`.

## Rollback
- Fast: restart context layer with `CTX_RESPONSES=off`.
- Full: revert hook in `context_layer/gating.js`, delete `context_layer/responses_compact.js`.
- Connection layer (`9router-proxy.js`) untouched.

## Rollout log
- T5.1 dry-run: run `CTX_RESPONSES=dry`, watch `[context][responses][dry]` + `/context-stats`
  (`responsesDryRunWouldCompact`, `responsesCompactErrors` must stay 0).
- T5.2 spill read: `on`, ask agent to `read_file` the spill path from a
  `…[context-proxy: …]` note. If unreadable, stop — lossless premise fails.
- T5.3 canary: ≥3 long sessions, no new 4xx on `function_call_output`/`call_id`,
  `responsesCompacted` up, `responsesCompactErrors=0`,
  `cached_tokens/input_tokens` ≥ 0.9 after first turn.

# kiro-cli via 9router (kiro_layer)
- Run `kiro_layer/kiro-9r [args]` instead of `kiro-cli` (default `chat`). Stop helper: `kiro-9r --stop`.
- kiro-cli >= 2.37 sends model calls as OpenAI Responses (`POST runtime.us-east-1.kiro.dev/v1/responses`).
  9router's built-in Kiro MITM only handles the legacy `/generateAssistantResponse`, so it passes these through.
- `kiro_layer/route_responses.py` (mitmproxy addon, :8080) rewrites only that call to `:20130/v1/responses`
  (-> context layer -> connection layer -> 9router). Auth/profile/model-list/MCP/telemetry stay on real Kiro.
- Model: `~/.9router/mitm/aliases.json` `kiro.<model>` (auto -> kr/auto); override with `KIRO_ROUTE_MODEL`.
  API key: first active key in 9router DB; override with `KIRO_ROUTER_API_KEY`.
- Trust: client uses mitmproxy CA (`~/.mitmproxy`); helper trusts public CAs + 9router root CA upstream
  (`/etc/hosts` sends kiro hosts to 9router's MITM on 127.0.0.1:443).
- Not routed: title/summary calls (`GenerateAssistantResponse`, binary eventstream) still go to Kiro.

# Planning instructions (instructions.active, 2026-11-03)
- Edited only the `active` row (25879 -> 30438 chars); `template` untouched (next `#9r-sync` + "generate" would overwrite these edits).
- Added: `### Parallel Sub-agent Execution` (task IDs, `Depends on:`, waves), all 4 plan artifacts created at plan time
  (`implementation_plan`, `task`, `parallel_execution`, Phase-1 `walkthrough`), `### Project Copy` (cp cache ->
  `<project>/.artifacts/<YYYY-MM-DD>-<title>/` at checkpoints) + `Copy exception` in the shell-edit guardrail.
- Scratch/backup: `~/Library/Caches/Google/AndroidStudio2026.2.1/projects/9router-proxy.5d78c4ad/.artifacts/cf921962-e13d-40a7-8fe2-ee86a0d5b6c7/scratch/`
  (`instructions-active-backup-2026-11-03.md`, `draft.md`, `check.js`, `save.js`).
- Rollback: in that dir, `node save.js instructions-active-backup-2026-11-03.md` (POSTs to :20130/api/instructions, verifies round-trip).

# Orchestration layer (orchestration_layer, 2026-11-07)
- Pipeline: `IDE -> orchestration_layer :20131 -> context_layer :20130 -> connection_layer :20129 -> 9router :20128`.
- Started inside `9router-proxy.js` (same LaunchAgent `com.local.9routerproxy.plist`) or standalone via `node orchestration_layer/server.js`.
- Dashboard & Admin API: `http://127.0.0.1:20131/orch` (`/orch/api/*`, `/orch/roster`).
- Storage: PostgreSQL `9router_proxy` tables `orch_models`, `orch_settings`, `orch_calls` (`storage_layer/schema.sql`) with warm in-memory cache for sub-ms routing and `setImmediate` async call logging.
- Forced model rewrite: `orchestration_layer` sets `x-orch-model` (+ `x-orch-model-context` for context budget) and writes `body.model` in `body` mode; `connection_layer` enforces `body.model = x-orch-model`, strips `x-orch-*` before 9router, and returns `x-orch-applied-model` + `x-orch-rewritten-by` for mismatch verification.
- Env: `ORCH_PORT` (`20131`), `ORCH_UPSTREAM` (`http://127.0.0.1:20130`), `ORCH_9ROUTER_URL` (`http://127.0.0.1:20128`), `ORCH_9ROUTER_API_KEY` (auto-resolved from `~/.9router/db/data.sqlite` if unset).
- Tests: `npm test` (`db-sync.test.js`, `admin-api.test.js`, `pipeline.test.js`).
- Fast rollback: toggle `enabled = false` in `/orch` (Orchestrator tab) or point IDE back to `:20130`.

