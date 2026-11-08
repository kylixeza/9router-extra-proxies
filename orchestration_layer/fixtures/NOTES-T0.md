# T0 Verification Notes — Real IDE `/v1/responses` & 9router `/v1/models`

Verified on 2026-11-07 against `proxy_logs` (`3,580` `/v1/responses` rows) and live `9router` (`http://127.0.0.1:20128/v1/models`, `200` models).

## 1. IDE `/v1/responses` Payload Shape

- **Top-level keys:** `input`, `model`, `store`, `tools`, `stream`, `instructions`, `parallel_tool_calls`, `reasoning`.
- **System instructions:** Sent in top-level `instructions` (string), **never** inside `role = 'user'` items. Scanning only `role === 'user'` items completely isolates `instructions` (including example markers like `<T-id>`).
- **User message wrapper (`<ide-context>`):** Every IDE user turn is `{ role: 'user', content: [{ type: 'input_text', text: '<ide-context>...</ide-context>\n\n<user-query>' }] }` (or plain string / `<user-query>` wrapper). Workspace `AGENTS.md` and open-file context sit inside `<ide-context>...</ide-context>`.
  - **Parser rule:** Strip everything up to and including the last `</ide-context>` tag in each user message before checking `/orch-plan`, `/orch-off`, or `[[ORCH ...]]` markers, so documentation/notes inside `<ide-context>` never false-trigger routing.
- **Sub-agent (`task` tool) turn:** Starts a fresh conversation (`input[0]` is `role: 'user'`) where the `task` `prompt` string sits right after `</ide-context>\n\n`. Sub-agent `tools[]` omits `task` and `set_plan_state`. Meanwhile, in the parent orchestrator conversation, `task` calls appear as `{ type: 'function_call', name: 'task', arguments: '{"prompt":"[[ORCH ...]]..."}' }` — ignored because `type === 'function_call'` is not `role === 'user'`.
- **`set_plan_state` session closer:** Appears in `body.input[]` as `{ type: 'function_call', name: 'set_plan_state', call_id: '...', arguments: '{"currentTask":"null","state":"COMPLETED","verified":true}' }`. Parsing `item.arguments` JSON for `state === 'COMPLETED'` reliably detects plan completion.
- **`previous_response_id`:** `0 / 3,580` requests use `previous_response_id` (IDE sends full `input[]` array every turn). Adapter still guards `if (body.previous_response_id)` as defensive fail-open.

## 2. 9router `/v1/models` & Model Switching

- **Auth:** Direct `GET http://127.0.0.1:20128/v1/models` requires `Authorization: Bearer <key>` (resolved from `ORCH_9ROUTER_API_KEY` env or `~/.9router/db/data.sqlite` `SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1`).
- **Response shape:** `{ object: 'list', data: [ ... ] }`. Top-level keys: `id`, `object`, `owned_by`, `capabilities`, `context_length`, `max_completion_tokens`.
- **Capabilities keys observed:** `vision`, `pdf`, `audioInput`, `videoInput`, `imageOutput`, `audioOutput`, `search`, `tools`, `reasoning`, `thinkingFormat`, `thinkingCanDisable`, `thinkingRange` (frequently `null`), `thinkingEffortSupported`, `contextWindow`, `maxOutput`.
- **Reasoning parameter:** IDE sends `reasoning: null` or `reasoning: { effort: 'none' | 'low' | 'medium' | 'high' }`. Models with `cap_reasoning = false` reject `reasoning` objects; models with `thinking_effort_supported = false` reject `reasoning.effort`. `null` values on capabilities mean unknown and must leave the request untouched.
