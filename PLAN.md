# omp-bot Development Plan

> Status: MVP complete. Bot replies to QQ messages with Zero personality.
> Next: Web Dashboard → Self-Growth → Polish.

---

## Phase 1: Web Dashboard (1-2 days)

### Why
No UI exists. Channel config, prompt editing, model selection all require SSH + file editing.

### Deliverables

**1.1 Dashboard SPA**
- Single HTML file served by `omp serve` HTTP server
- Dark terminal aesthetic (OMP design language: deep charcoal, ANSI palette)
- Sections:
  - Overview: uptime, QQ connection status, message/reply count, session count
  - Channels: per-user/group trigger mode config (all/mention_only/smart/off), keywords, edit/remove
  - Persona: system prompt textarea with live edit + save
  - Activity: recent messages with reply status (replied/skipped/error)
  - Capabilities: model selector, installed plugins list
- API-driven: reads from `GET /api/*`, writes via `POST /api/*`

**1.2 Dashboard API Endpoints**
New endpoints on the serve HTTP server:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config/channels` | List all channel configs |
| POST | `/api/config/channels` | Upsert channel config |
| DELETE | `/api/config/channels/:key` | Remove channel config |
| GET | `/api/config/prompt` | Get current system prompt |
| PUT | `/api/config/prompt` | Update system prompt |
| GET | `/api/activity` | Recent message log (last 100) |
| GET | `/api/sessions` | Active sessions list |
| GET | `/api/plugins` | Installed plugins |
| GET | `/api/models` | Available models |

**1.3 Channel Config Persistence**
- Move from in-memory Map to `/data/channels.json`
- Load on startup, save on change
- Survives restarts

### Files to create/modify
| File | Change |
|------|--------|
| `chat/dashboard-api.ts` | New — API route handlers |
| `chat/dashboard.html` | New — SPA |
| `chat/trigger-decider.ts` | Edit — JSON persistence |
| `chat/bot-runner.ts` | Edit — mount API routes |

---

## Phase 2: Self-Growth (2-3 days)

### Why
Zero's prompt says she can install plugins. She can't. Make it real.

### Deliverables

**2.1 Plugin Install Tool**
Register `install_plugin` as an OMP tool accessible to Zero:
- Calls `omp plugin marketplace add` + `omp plugin install` via bash
- Zero discovers a need → searches marketplace → installs → applies
- Safety: whitelist of allowed plugin sources (OMP marketplace only)
- Logs all installations to `/workspace/plugin-log.md`

**2.2 Self-Improvement Loop**
- `/workspace/self-improvement.md` — Zero writes reflections
- Every N conversations, Zero reads her own self-improvement notes
- `/workspace/proposed-changes.md` — prompt change proposals (human-reviewed via dashboard)

**2.3 Capability Discovery**
Zero should occasionally check what plugins are available:
- `omp plugin marketplace search <query>` exposed as tool
- Dashboard shows available marketplace plugins

### Files
| File | Change |
|------|--------|
| `chat/qq-tools.ts` | Add `install_plugin`, `search_plugins` tool functions |
| `chat/bot-runner.ts` | Register plugin tools |
| `chat/dashboard-api.ts` | Add plugin list/search endpoints |

---

## Phase 3: Polish & Reliability (2-3 days)

### 3.1 Group Chat
- Test and fix group chat message flow
- @mention detection via CQ parse (already implemented)
- Per-group trigger modes via dashboard

### 3.2 Rich Media
- Connect image CQ codes → vision model (if configured)
- Voice message handling (transcription stub)
- File message handling

### 3.3 Language Validation
- Post-response check: does reply language match user message language?
- If mismatch → regenerate with explicit language instruction

### 3.4 Health Monitor
- OneBot connection health (already has heartbeat)
- NapCat restart on persistent failure (via docker restart bash command)
- Alert dashboard on issues

### 3.5 Error Recovery
- Agent turn timeout (60s max, kill and report)
- Session cleanup for stale sessions (>24h idle)
- Graceful shutdown on SIGTERM

---

## Phase 4: Advanced (future)

### 4.1 Multi-Model Routing
- Different models for different tasks (fast model for simple replies, powerful model for analysis)
- Configurable per-channel

### 4.2 Conversation Summarization
- Long conversations auto-summarized into memory.md
- Prevents context window from overflowing

### 4.3 Multi-Bot
- Multiple QQ accounts on one omp-bot instance
- Different personalities per account

---

## Priority Order

```
Phase 1 (Dashboard)  ← Do now. Unblocks all config work.
Phase 2 (Self-Growth) ← Core differentiator. Makes Zero autonomous.
Phase 3 (Polish)    ← Makes it production-ready.
Phase 4 (Advanced)  ← Nice to have.
```

---

## Current Code Audit

11 files in `packages/coding-agent/src/chat/`:

| File | State | Notes |
|------|-------|-------|
| `bot-prompt.ts` | ✅ | Zero personality v2 |
| `bot-runner.ts` | ✅ | Server + dispatch + auto-send |
| `onebot-gateway.ts` | ✅ | Reverse WS server + send() |
| `qq-tools.ts` | ✅ | qqSendMessage works; getMsg/getHistory are async stubs |
| `serve-cli.ts` | ✅ | Thin re-export |
| `message-queue.ts` | ✅ | Ring buffer 500 |
| `trigger-decider.ts` | ⚠️ | Works, config in-memory only |
| `cq-parser.ts` | ✅ | 11 segment types |
| `bot-context.ts` | ⚠️ | Redundant with cq-parser; unreferenced |
| `onebot-types.ts` | ✅ | Type definitions |
| `session-manager.ts` | ✅ | Per-user sessions + Zero prompt injection |
