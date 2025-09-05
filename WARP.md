<!--
WARP.md - Workspace Agent Rules & Protocol
Purpose: Canonical rulebook for LLM / automation agents contributing ONLY under `src/`.
Keep sections stable; add new sections rather than rewriting existing semantics.
-->

# WARP: MCP Hub Development Rulebook

Project: mcp-hub (Node.js MCP server hub & capability aggregator)  
Status: Active (post-tool-index + meta-tools)  
Focus Area (for agents): Source code (`src/`) only unless explicitly whitelisted.

## 1. Core Principles
1. Preserve backward compatibility (config formats, namespacing delimiter `__`, REST response shapes).
2. Fail fast with structured errors (classes in `src/utils/errors.js`).
3. Prefer composition & delegation (route handlers delegate to service classes; no large inline logic in Express handlers).
4. Deterministic outputs for meta-tools (stable ordering, pagination ready patterns for future use).
5. Zero secret leakage (never log raw tokens / API keys; redact when necessary).

## 2. Namespacing & Identity
- Tool/Prompt/Resource exposed to internal hub MCP = `<serverName>__<capabilityName>`.
- Changing delimiter or scheme requires: (a) README update (b) migration note (c) version bump.
- Centralized tool index `toolId` equals namespaced name; uniqueness enforced by combination.

## 3. Event & State Model
Enumerations defined centrally:
- Hub states: `STARTING|READY|RESTARTING|RESTARTED|STOPPING|STOPPED|ERROR` (see `sse-manager.js`).
- Subscription events: `CONFIG_CHANGED|SERVERS_UPDATING|SERVERS_UPDATED|TOOL_LIST_CHANGED|RESOURCE_LIST_CHANGED|PROMPT_LIST_CHANGED|WORKSPACES_UPDATED`.
Additions require extending enums + updating README + SSE consumer tests.

## 4. Directory Rules (src/)

### 4.1 `src/server.js`
- Register routes ONLY via `registerRoute` helper for automatic documentation.
- Keep handlers thin: parse + validate + delegate.
- Map errors to HTTP via central status function; never duplicate mapping logic.
- New routes must document: method, path, expected JSON shape (in README if public).

### 4.2 `src/mcp/server.js`
- Maintain namespacing logic; no per-tool business logic here—only routing to the right connection.
- Enforce request timeout constant (`MCP_REQUEST_TIMEOUT`).
- On capability refresh: send appropriate SSE events through hub emitter.

### 4.3 `src/mcp/toolset-registry.js`
- Meta-tools must begin `hub__` and return `{ content: [...] , isError? }`.
- Validate inputs; throw `McpError` with `ErrorCode.InvalidParams` for malformed args.
- Auto-sync index on tool/server list changes. Avoid blocking operations without abort signals.
- `hub__chain_tools` currently placeholder—extend only with clearly defined chain spec.

### 4.4 `src/MCPHub.js`
- Lifecycle: isolate config reload vs connection restart; emit `servers_updating` then `servers_updated`.
- Batch operations must `Promise.allSettled` to prevent single failure aborting sequence.
- Lazy connect mode may defer actual connection until first capability access—keep logic intact.

### 4.5 `src/MCPConnection.js`
- States: `CONNECTING|CONNECTED|DISCONNECTED|UNAUTHORIZED|DISABLED` only; document before adding more.
- Wrap underlying transport errors into `ConnectionError` or `ToolError` accordingly.
- Keep notification handler detach logic symmetrical with attach.
- Avoid leaking raw stderr from child processes unless flagged as non-sensitive diagnostic.

### 4.6 `src/utils/config.js`
- Merge strategy: earlier → later override; `mcpServers` merged by key; other root keys replaced.
- VS Code compatibility (`servers`) must remain; do not remove original key when normalizing.
- Diff object MUST retain keys: added, removed, modified, unchanged, details.

### 4.7 `src/utils/env-resolver.js`
- New placeholder pattern must implement: detection, resolution, recursion guard, cycle detection.
- Maintain strict mode throwing on unresolved placeholders unless explicit null fallback.
- Always abort commands on timeout (if introducing execution limits) and sanitize output.

### 4.8 `src/utils/tool-index.js`
- Keep O(1) lookups: `tools`, `byServer`, `byName`, `byCategory` maps in sync.
- Re-registration replaces previous server tools atomically.
- Stats fields (`totalTools`, `totalServers`, timestamps) must update on mutations.

### 4.9 `src/utils/dev-watcher.js`
- Debounce window fixed (500ms) unless explicit config extension—update docs if changed.
- Only emit change events; no business logic or auto-restarts baked in here.

### 4.10 `src/utils/sse-manager.js`
- Heartbeat interval default 10s; configurable via constructor.
- Auto-shutdown emits hub state transitions; ensure timer cancellation on new connection.

### 4.11 `src/utils/logger.js`
- Structured log shape: `{ type, code?, message, data, timestamp }`.
- File logging path must remain XDG compliant with legacy fallback.
- New log levels require updating `LOG_LEVELS` map and downstream filters.

### 4.12 `src/utils/workspace-cache.js`
- File locking must stay atomic; never write partial JSON (write temp + atomic rename if altering strategy).
- Cleanup pass should verify PID still alive before removal.

### 4.13 `tests/`
- For each new feature: success + failure + boundary (empty input, large pattern, missing server).
- Update coverage summary below after adding tests.

## 5. Meta-Tools Contract
Return object: `{ content: [ { type: 'text', text: string } | resourceObj | imageObj ... ], isError?: boolean }`.
Errors: throw `McpError` (preferred) or return `isError: true` with diagnostic text. Avoid mixing both.

## 6. Error Handling Policy
- Convert raw exceptions with `wrapError` OR instantiate proper subclass.
- Do not expose stack traces over public HTTP in production mode (logger handles stack).
- HTTP mapping centralized; new error codes map to 400 (validation), 404 (missing), 409 (conflict), 500 (internal) by default.

## 7. Logging & Observability
- Use `logger.info|warn|error|debug` only; no `console.*` calls in new code.
- Emit `logCapabilityChange` for tool/resource/prompt list transitions.
- Avoid high-volume debug loops (batch or rate limit if necessary).

## 8. Performance Guidelines
- Prefer cached index for tool listings; only force refresh with explicit flag.
- Lazy connection pattern reduces startup latency—preserve semantics.
- Avoid synchronous filesystem scans in hot paths; precompute where possible.

## 9. Security Guidelines
- Redact secrets (`API_KEY`, `Authorization` headers) before logging.
- OAuth JSON storage: changes require migration function (write new file, keep old backup).
- Never execute unbounded shell commands; restrict `${cmd:}` usage to trusted configs (document risk in README if extended).

## 10. Configuration Semantics
- Placeholder precedence: command expansions → env resolution → predefined vars → input variables.
- `null` / empty env values fallback to `process.env` where key exists.
- Multi-file load order defines override priority (later overrides earlier).

## 11. SSE Event Evolution Checklist
1. Add enum value.
2. Emit from correct lifecycle point.
3. Update README (Events table).
4. Add test ensuring event emission.
5. Bump minor version.

## 12. Centralized Tool Index Workflow
Registration sources:
1. Automatic sync on server connect / toolsChanged.
2. REST `/api/tools/register` external injection.
3. Manual refresh via meta-tool listing with `refresh` flag (future).
Consistency checks: ensure tool count matches per-server list after sync; log discrepancies at `warn` level.

## 13. Release Checklist (Source Changes)
1. All tests green (vitest).
2. README + WARP updated (sections appended, not overwritten) if public API or meta-tools changed.
3. Changelog entry (Added/Changed/Fixed/Removed).
4. Version bump.
5. Optional: run smoke against example config.

## 14. Protected Boundaries
- Do NOT change external MCP protocol semantics.
- Do NOT remove legacy `servers` key normalization.
- Do NOT alter namespacing delimiter without migration path.
- Do NOT log whole child process environment.

## 15. Current Test Coverage Summary
- Total test files: 16 (toolset registry, hub lifecycle, config, env resolver, marketplace, CLI, connection integration, index)
- Additions must increment this section with new count & brief purpose.

## 16. Roadmap Hooks (For Future Sections)
- Tool chaining engine (`hub__chain_tools` real implementation) – design doc required.
- Analytics/usage metrics export – privacy review needed.
- UI layer integration – keep REST + SSE stable.

## 17. Quick Reference Table
| Task | File(s) | Action |
|------|---------|--------|
| Add meta-tool | `src/mcp/toolset-registry.js` | Define tool object + handler, update README docs. |
| Add REST route | `src/server.js` | Use `registerRoute`, add README section. |
| New event type | `src/utils/sse-manager.js` | Extend enums + broadcast + docs + tests. |
| New placeholder | `src/utils/env-resolver.js` | Implement resolver + docs + tests. |
| Config merge rule | `src/utils/config.js` | Adjust merge + diff tests. |
| Tool index feature | `src/utils/tool-index.js` | Maintain map invariants + stats update. |

## 18. Session Log
- 2025-09-03: Centralized tool index + meta-tools integrated.
- 2025-09-04: README + WARP refactored with structured ruleset.

---
This WARP file is the authoritative operational contract for source-level contributions. Append new sections rather than rewriting existing ones.
