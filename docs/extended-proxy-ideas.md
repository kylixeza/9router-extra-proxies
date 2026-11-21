# Extended Proxy Feature Research for `9router-proxy`

Catalog of AI coding agent and LLM gateway features implementable as extended HTTP/SSE proxy layers on top of the existing `9router-proxy` pipeline:

```text
Agent (IDE / CLI)
  -> :20131 orchestration_layer (role routing, roster injection, media adapter)
  -> :20130 context_layer       (tool/skill gating, lossless spill/compaction, token alerts, instructions)
  -> :20129 connection_layer    (forced rewrite, retries/fallbacks, 8s POST dedup, log redaction)
  -> :20128 9router
```

---

## Tier 1 — Highest ROI (Low risk, immediate cost/reliability win)

### 1. Prompt Cache Breakpoint & Prefix Stabilizer
*Inspired by: Claude Code (`cache_control: ephemeral`), OpenAI `prompt_cache_key`, Gemini Implicit/Explicit Caching, Cline/Roo Code*

- **Pipeline Placement:** End of `context_layer` (right after gating/compaction) or `connection_layer`.
- **Proxy Process:**
  1. Intercept outbound JSON request (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`).
  2. Enforce deterministic ordering of static prefix: `tools` (sorted by name) -> `system` -> static project rules -> message history. Strip volatile fields (timestamps, request IDs, random whitespace) from prefix and move volatile metadata to tail user message.
  3. Inject provider-specific cache hints:
     - **Anthropic/Claude:** attach `cache_control: { type: "ephemeral" }` on last tool definition, system block, and `N-2` / `N-1` conversation turns (up to 4 breakpoints).
     - **OpenAI:** derive deterministic `prompt_cache_key` from `(convId + model)` so requests pin to the same cache shard.
  4. Track `cached_tokens / input_tokens` in PostgreSQL (`proxy_logs`) and alert when cache hit rate drops (prefix instability detector).
- **Pros:**
  - 50–90% input token cost reduction + lower TTFT on multi-turn coding sessions.
  - Complements existing `context_layer` suffix-append compaction.
- **Cons:**
  - Mid-session MCP tool gating changes or dynamic system instruction edits bust the prefix cache.
  - Anthropic charges a cache-write premium (1.25x–2x), which hurts 1-turn calls unless gated by min token/turn count.

---

### 2. Doom-Loop / Thrashing Detector & Circuit Breaker
*Inspired by: OpenHands (`StuckDetector`), OpenCode (doom-loop guard), Cline (`consecutiveMistakeLimit`)*

- **Pipeline Placement:** `context_layer` (reuses `convId`, `sendSyntheticAssistantReply`, macOS confirmation dialog).
- **Proxy Process:**
  1. Maintain a per-`convId` sliding window of recent `(tool_name, canonical_args_hash, tool_error_flag)`.
  2. On each incoming request, scan recent `assistant` tool calls and `tool` results in `messages`/`input`:
     - **Repeat loop:** identical `(tool_name, args_hash)` >= 3x consecutively.
     - **Ping-pong cycle:** alternating `A -> B -> A -> B` >= 2 cycles.
     - **Error spiral:** >= 4 consecutive tool errors without file-edit progress.
  3. Trigger configurable action:
     - **Soft nudge:** inject tail reminder instructing the model to switch strategy or ask the user.
     - **Hard break:** short-circuit request via `sendSyntheticAssistantReply` to pause the loop, optionally prompting via macOS dialog.
- **Pros:**
  - Stops runaway token burn when agents get stuck on failing tests or broken diffs.
  - Zero latency overhead (pure local hash check); works uniformly across all IDEs/models.
- **Cons:**
  - False positives on valid iterative workflows (e.g., running tests repeatedly while editing files — must reset counters on successful edits).
  - Soft nudge slightly perturbs prompt tail.

---

### 3. Outbound Secret / PII Scrubber + Bidirectional Vault Re-Hydrator
*Inspired by: LiteLLM (Presidio), Portkey PII Guardrail*
*(Note: `connection_layer` currently redacts logs only, not upstream prompts leaving the machine.)*

- **Pipeline Placement:** `connection_layer` (last hop before `9router`).
- **Proxy Process:**
  1. **Outbound:** scan `messages`/`input` (especially `read_file` and shell tool outputs) with regex + Shannon entropy checks for API keys, JWTs, `.env` secrets, private keys, emails/IPs.
  2. Replace matches with deterministic per-session placeholders (`__SECRET_AWS_KEY_1__`) stored in an ephemeral in-memory session vault (never persisted to disk/PG).
  3. **Inbound (SSE & JSON):** run a streaming lookahead replacer over response chunks (`delta.content` and `tool_calls[].arguments`) to restore raw values before the IDE displays text or executes tools (optionally restore only inside `tool_calls`).
- **Pros:**
  - Prevents leaking real `.env` credentials/tokens to external LLM providers.
  - Models continue reasoning accurately using consistent deterministic tokens.
- **Cons:**
  - Streaming re-hydration needs a small lookahead buffer when partial chunks match placeholder prefixes.
  - Risk of false positives on base64 hashes or test fixtures.
  - If the model mangles a placeholder token, re-hydration misses.

---

### 4. Tool-Call Safety Firewall & PreToolUse Policy Gate
*Inspired by: Claude Code `PreToolUse` hooks, Codex CLI `.rules` (`prefix_rule`), Cline/Roo Code command denylist & path regex*

- **Pipeline Placement:** New `guardrail_layer` or inside `context_layer` response path.
- **Proxy Process:**
  1. Inspect/buffer upstream SSE/JSON `tool_calls` before flushing final tool-call completion to the IDE.
  2. Match tool name + parsed JSON arguments against local policy rules (e.g., shell commands matching `rm -rf`, `git push --force`, `curl | sh`; file writes outside project root or targeting `.env`/`.ssh`).
  3. Apply rule verdict:
     - `allow`: forward response untouched.
     - `deny` / `rewrite`: strip dangerous `tool_call` and emit synthetic assistant explanation, or rewrite arguments safely (e.g. add `--dry-run`).
     - `prompt`: show macOS confirmation dialog before releasing the tool call to the IDE.
- **Pros:**
  - Centralized safety rules across every client (Android Studio, Codex, Kiro, Cursor), even with client auto-approve enabled.
  - Deterministic, zero extra LLM token cost.
- **Cons:**
  - Must buffer `tool_call` SSE deltas until argument JSON finishes before evaluating rules (perceived pause on large file-write tool calls).
  - Governs model intent only — cannot replace OS-level sandboxing (e.g., macOS Seatbelt / Linux Landlock).

---

## Tier 2 — Intelligence, Quality & Context Upgrades

### 5. Malformed Tool-Call & Schema Auto-Repair Proxy
*Inspired by: OpenCode `invalid` tool repair, Cline parser fallback, Instructor / LiteLLM repair hooks*

- **Pipeline Placement:** `connection_layer` or `orchestration_layer` response pipeline.
- **Proxy Process:**
  1. Inspect upstream tool-calling responses for common weaker-model failures:
     - Tool call emitted as markdown/XML prose (`<tool_call>...</tool_call>`) instead of native `tool_calls`.
     - Broken JSON arguments (trailing commas, unescaped newlines, code fences).
     - Unknown tool name (fuzzy-match against request `tools`) or missing required schema fields.
  2. **Deterministic repair:** fix JSON syntax / convert XML blocks into valid OpenAI `tool_calls` structure and forward to client.
  3. **Internal retry fallback:** if unrepairable, silently append a synthetic `tool` error observation (`"Invalid args for X: missing field Y"`) and run 1 internal retry against upstream (or a fixer model) before returning a clean response to the IDE.
- **Pros:**
  - Makes cheaper/open-weight models (Qwen, DeepSeek, local models) reliable inside strict IDEs without crashing agent loops.
- **Cons:**
  - Requires buffering tool-call SSE chunks rather than pure streaming passthrough.
  - Internal retry adds one extra LLM round-trip on broken calls; client usage counters may undercount unless summed usage is returned.

---

### 6. Dynamic Complexity & Reasoning-Effort Auto-Router
*Inspired by: RouteLLM (LMSYS), OpenRouter Auto, Cursor Auto, OpenAI `reasoning_effort`, Gemini `thinkingLevel`, Claude adaptive effort*

- **Pipeline Placement:** `orchestration_layer` (extends `router.js` beyond explicit `/orch-plan`).
- **Proxy Process:**
  1. For requests not pinned by `/orch-plan`, extract lightweight features from the latest user turn and session state (token count, code/diff presence, stack traces, intent keywords, turn depth).
  2. Classify complexity (`trivial` / `standard` / `hard`) via fast local heuristics or a tiny classifier (<30ms).
  3. Adjust:
     - **Model tier:** fast/cheap model for simple turns, frontier model for hard turns; and/or
     - **Reasoning effort:** scale `reasoning_effort` (`low`/`medium`/`high`), `thinkingConfig.thinkingLevel`, or Anthropic `thinking.budget_tokens` dynamically.
- **Pros:**
  - Cuts cost and latency automatically on routine lookups/edits without manual commands.
  - Scaling reasoning effort within the same model preserves provider prompt caches.
- **Cons:**
  - Switching models mid-conversation invalidates provider prompt cache (prefer effort-scaling mid-chat, model-switching on turn 1 or isolated sub-agents).
  - Misclassifying a subtle bug as trivial degrades answer quality.

---

### 7. Semantic Rolling History Summarizer (LLM Auto-Compact)
*Inspired by: Claude Code `/compact` & auto-compact, Codex CLI `model_auto_compact_token_limit`, Cline/Roo Code context condensation*
*(Note: `context_layer` currently performs lossless tool-output spill/dedup, not semantic summarization of old dialogue turns.)*

- **Pipeline Placement:** `context_layer` (stage 2 fallback after lossless spill/dedup).
- **Proxy Process:**
  1. Watch `effectiveTokens / modelContextBudget`.
  2. Above threshold (e.g., >75%), preserve system prompt + pinned instructions + last `K` turns.
  3. Send older middle turns to a fast, cheap summarizer model with a structured schema (active goal, modified files, architectural decisions, open bugs, pending steps).
  4. Cache the summary keyed by `(convId, compactedUpToMsgHash)` in PG/memory so subsequent turns reuse the identical summary prefix (only 1 prompt-cache miss per compaction cycle).
- **Pros:**
  - Enables arbitrarily long IDE sessions without hitting context limits or suffering "lost in the middle" degradation.
  - Works even in IDEs without native compaction.
- **Cons:**
  - One-time prompt cache miss whenever compaction triggers.
  - Lossy: subtle early constraints can be dropped.
  - Adds a 2–5s pause on the compaction turn; IDE UI history diverges from the compacted history sent upstream.

---

### 8. Cross-Session Project Memory & Glob-Matched Rules Injector
*Inspired by: Claude Code Auto-Memory (`MEMORY.md`), Mem0, Windsurf Memories, Continue/Cursor `.rules` glob matching*

- **Pipeline Placement:** `context_layer` + `storage_layer` (reuses PG + `storage_layer/project.js`).
- **Proxy Process:**
  1. Detect active project and recently referenced file paths from conversation messages.
  2. **Sync injection (pre-request):**
     - Load project rule files matching touched path globs (e.g. `*.gradle.kts`, `**/test/**`) and inject at turn tail.
     - Query PG (`tsvector` full-text search or `pgvector`) for top-K durable project facts/preferences and inject cleanly.
  3. **Async extraction (post-response):** background worker feeds `(user_msg, assistant_msg)` to a cheap model to extract durable facts/corrections and upsert into a `project_memories` table.
- **Pros:**
  - Gives persistent cross-session memory and conditional file rules to every IDE/CLI automatically.
  - Zero latency added by extraction (runs asynchronously post-response).
- **Cons:**
  - Stale or wrong memories pollute future sessions (requires TTL/decay + dashboard UI to inspect/prune).
  - Injecting changing memories into the system prompt breaks prompt caching (must freeze at turn 1 or inject near tail).

---

### 9. Speculative / Predicted Outputs Auto-Injector
*Inspired by: Cursor Fast Apply, OpenAI `prediction: { type: "content" }`*

- **Pipeline Placement:** `context_layer` or `connection_layer`.
- **Proxy Process:**
  1. Track recent `read_file` tool outputs per `convId` in memory (`filepath -> content`).
  2. When an edit-intent turn targets a recently read file on a compatible model (e.g. non-reasoning OpenAI models without conflicting parameters), attach `prediction: { type: "content", content: lastReadFileContent }`.
- **Pros:**
  - 2–4x faster token output on full-file rewrites via provider speculative decoding.
  - Transparent to the client IDE.
- **Cons:**
  - Narrow API support (OpenAI rejects `prediction` on reasoning models and certain tool/endpoint combinations).
  - Rejected draft tokens are still billed if the rewrite differs substantially from the original file.

---

## Tier 3 — Power-User / Advanced Proxy Patterns

### 10. Dual-Model Architect / Editor (or Critique / Verify) Middleware
*Inspired by: Aider Architect/Editor mode, Claude Code Stop-hook verification*

- **Pipeline Placement:** `orchestration_layer`.
- **Proxy Process:**
  1. Activated via slash command (`/verify`, `/arch-edit`) or dashboard toggle.
  2. **Architect/Editor mode:** forward prompt with tools stripped to a strong reasoning model to get a plain-text solution, then pipe that plan + original `tools` schema into a fast tool-calling Editor model and stream Editor's `tool_calls` back to the IDE.
  3. **Self-Critique mode:** buffer draft response, run a fast reviewer model against a strict checklist (hallucinated APIs, missing edge cases, broken diffs), and run one refinement pass if issues are flagged.
- **Pros:**
  - Lets strong reasoning models with poor tool-calling drive IDE tool loops cleanly.
  - Catches obvious bugs before the IDE applies broken edits.
- **Cons:**
  - Doubles latency and delays streaming during pass 1 (requires SSE `: keep-alive\n\n` heartbeats to avoid IDE timeouts).
  - Higher token spend per turn.

---

### 11. Spend Budget Manager, Rate-Limit-Aware Routing & Semantic Cache
*Inspired by: LiteLLM Budget Manager & Semantic Cache, Helicone, Portkey, Cloudflare AI Gateway*

- **Pipeline Placement:** `connection_layer` + `storage_layer`.
- **Proxy Process:**
  1. **Budgets & Quotas:** track rolling hourly/daily spend and token counters per `(project, model, provider)` using a pricing map:
     - Soft cap -> auto-downgrade to cheaper fallback tier.
     - Hard cap -> return synthetic assistant reply explaining limit reached.
     - Parse upstream `429` and `x-ratelimit-remaining-*` headers to route away from near-exhausted providers proactively.
  2. **Long-TTL / Semantic Cache (optional):** for stateless/non-tool requests (titles, summaries, autocomplete, docs Q&A), hash normalized prompt or embed via local model -> PG lookup (cosine > 0.96) -> replay cached response immediately.
- **Pros:**
  - Prevents runaway API bills and reactive 429 retry stalls.
  - Integrates naturally with existing Leon/Valiant dashboards.
- **Cons:**
  - Semantic cache rarely hits on stateful multi-turn agent loops (useful mainly for stateless helper calls).
  - Pricing table needs periodic maintenance.

---

### 12. Shadow Traffic & Offline Replay Evaluation Harness
*Inspired by: TensorZero, Bifrost, Helicone / Portkey eval pipelines*

- **Pipeline Placement:** `connection_layer` + `storage_layer` (async post-response hook).
- **Proxy Process:**
  1. Primary request runs normally with zero user latency impact.
  2. On a configurable sample rate (e.g. 5%) or tagged turns (`/shadow`), asynchronously mirror the identical request to a candidate model.
  3. Record `(primary_output, shadow_output, latency_delta, token_cost_delta, tool_schema_valid)` into a PG `shadow_evals` table.
  4. Optional CLI replays historical `proxy_logs` rows against new system prompts, compaction settings, or candidate models and diffs results.
- **Pros:**
  - Empirically benchmarks cheaper `orchestration_layer` workers/fixers or `context_layer` compaction tweaks on real IDE traffic before rollout.
- **Cons:**
  - Extra API spend for mirrored calls.
  - Evaluates single-turn accuracy only, not multi-turn trajectory divergence.

---

## Comparison Matrix

| # | Feature | Best Layer | Complexity | Prompt-Cache Impact | Primary Value |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Prompt Cache Breakpoint & Prefix Stabilizer | `context` / `connection` | Low | Strong positive | 50–90% input cost & TTFT win |
| 2 | Doom-Loop / Thrashing Circuit Breaker | `context` | Low | Neutral | Stops stuck agent loops |
| 3 | Outbound Secret/PII Vault Scrubber | `connection` | Medium | Neutral (if deterministic) | Protects `.env` & keys upstream |
| 4 | Tool-Call Safety Firewall (`PreToolUse`) | `context` / new layer | Medium | Zero | Safe auto-approve across all IDEs |
| 5 | Malformed Tool-Call Auto-Repair | `connection` | Medium | Neutral | Makes cheap/OSS models reliable |
| 6 | Dynamic Complexity & Effort Auto-Router | `orchestration` | Medium | Positive (effort scaling) | Automatic cost/speed balance |
| 7 | Semantic Rolling History Summarizer | `context` | Medium | 1x miss on trigger | Endless sessions past context cap |
| 8 | Cross-Session Memory & Glob Rules | `context` + `storage` | High | Neutral (if tail-injected) | Persistent rules/facts across IDEs |
| 9 | Predicted Outputs Auto-Injector | `context` / `connection` | Low | Neutral | Faster file rewrites on supported APIs |
| 10 | Architect/Editor or Critique Loop | `orchestration` | High | Misses on extra pass | Higher accuracy / reasoning->tool bridge |
| 11 | Spend Caps & Rate-Limit-Aware Router | `connection` + `storage` | Low–Med | Neutral | Prevents 429 stalls & bill spikes |
| 12 | Shadow Traffic & Replay Eval | `connection` + `storage` | Medium | Zero | Benchmarks models on real traffic |

## Recommended First Wave

Start with **#1 (Prompt Cache Breakpoint)**, **#2 (Doom-Loop Breaker)**, **#4 (Tool-Call Firewall)**, and **#5 (Tool-Call Repair)**. All four reuse existing primitives (`convId`, `sendSyntheticAssistantReply`, macOS dialog, PG `proxy_logs`) and require zero external services.
