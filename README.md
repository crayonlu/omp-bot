<p align="center">
  <strong>Zero (零)</strong> — QQ bot powered by
  <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a>.
</p>

<p align="center">
  <a href="https://github.com/crayonlu/omp-bot"><img src="https://img.shields.io/badge/fork-crayonlu/omp-bot-58A6FF?style=flat&colorA=222222" alt="fork"></a>
  <a href="https://github.com/can1357/oh-my-pi"><img src="https://img.shields.io/badge/upstream-can1357/oh-my-pi-3FB950?style=flat&colorA=222222" alt="upstream"></a>
</p>

A persistent QQ chatbot with full LLM reasoning, multi-turn sessions, image understanding, web search, code execution, and self-growth tools — all running on the oh-my-pi agent framework.

## Features

- **Multi-turn conversation** — Session persistence across messages with full conversation history
- **Vision support** — Automatic MiniMax M3 model switching when images are detected
- **Streaming replies** — Chunked text delivery via QQ for natural typing feel
- **Slash commands** — `/clear` to reset session context
- **Web search** — Built-in via SearXNG or other providers; model can trigger inline
- **Code execution** — Python/JavaScript eval for data analysis, visualization, automation
- **File I/O** — Read/write files in the workspace; download and analyze images
- **Self-growth** — Can install plugins, search marketplaces, write tools autonomously
- **Crash recovery** — Self-healing: detects crash markers and recovers gracefully
- **Dashboard** — Web UI at port 3099 for monitoring activity and configuration

---

## Architecture

```
NapCat (QQ protocol)                     omp-bot (Docker)
┌───────────────┐     WebSocket     ┌────────────────────────┐
│               │ ◄─────────────── │  OneBot Gateway        │
│  QQ → NapCat  │                  │  ws://:3001/onebot/ws  │
│               │ ────────────────►│                        │
└───────────────┘  send message    │  Message Pipeline      │
                                   │    ↓ ingress (parse)   │
                                   │    ↓ enrich (images)   │
                                   │    ↓ format (prompt)   │
                                   │    ↓ dispatch (OMP)    │
                                   │    ↓ respond (reply)   │
                                   │                        │
                                   │  Agent Session         │
                                   │    ↓ model inference   │
                                   │    ↓ tool execution    │
                                   │    ↓ streaming reply   │
                                   │                        │
                                  │  Dashboard :3099       │
```

### Message Flow

1. User sends message in QQ
2. NapCat receives it, forwards to omp-bot via WebSocket (OneBot protocol)
3. Pipeline **ingress** parses message segments (text, images, replies)
4. **Enrich** downloads images to base64 data URIs
5. **Format** builds the prompt with timestamp, user context, and attachments
6. **Dispatch** sends prompt to OMP agent session
7. Agent reasons, calls tools (web search, eval, etc.), generates reply
8. Reply streamed back via **respond** → `send_private_msg` action to NapCat
9. User sees typing indicators and receives message in parts

---

## Quick Start

### Prerequisites

- Docker + NapCat (or any OneBot v11 compatible QQ client)
- PPIO API key (or any provider supported by oh-my-pi)

### Deploy

```bash
# 1. Clone
git clone https://github.com/crayonlu/omp-bot.git
cd omp-bot

# 2. Configure NapCat — connect to the bot's WS server
#    NapCat config (onebot11.json):
#    {
#      "wsServer": "ws://<bot-host>:3001/onebot/ws",
#      "reconnectInterval": 5000
#    }

# 3. Create config directory
mkdir -p /data/.omp

# 4. Set API key
export PPIO_API_KEY="sk-..."

# 5. Start bot
docker run -d --name omp-bot \
  -p 3099:3099 \
  -p 3001:3001 \
  ghcr.io/crayonlu/omp-bot:latest \
  serve --port 3099
```

### Verify

```bash
curl http://localhost:3099/health
# → {"ok":true,"onebot_connected":true}
```

---

## Slash Commands

| Command | Description |
|---|---|
| `/clear` | Reset session — clears all conversation history |

---

## Dashboard

The web dashboard runs on port **3099**:

- **Chat** — Real-time conversation log
- **Activity** — Message history with reply status
- **Model** — Current model and provider info
- **Settings** — Bot configuration (model, web search, marketplace)

---

## Configuration

Bot settings stored in `/data/bot-config.json`:

```json
{
  "model": "",
  "promptOverride": null,
  "marketplace": { "autoUpdate": "off" },
  "webSearch": { "enabled": true, "provider": "searxng", "endpoint": "https://search.cyncyn.xyz" }
}
```

Adjustable via the Dashboard settings panel.

---

## Session Management

- Sessions persist to `/root/.omp/agent/sessions/` (mounted volume)
- Messages are saved per-session as JSONL files
- Session resumes on restart via `SessionManager.open()`
- Use `/clear` to reset when context gets too long or model behaves unexpectedly

---

## Development

### Local setup

```bash
bun install
cd packages/coding-agent
bun run src/cli.ts serve --port 3099
```

### Key source directories

packages/coding-agent/src/chat/
├── bot-runner.ts          # Entry point: HTTP + WebSocket + message loop
├── bot-config.ts          # Config read/write
├── bot-prompt.ts          # System prompt (Zero persona)
├── bot-context.ts         # Context building utilities
├── session-manager.ts     # Bot session lifecycle
├── serve-cli.ts           # Re-export for omp serve command
├── dashboard-api.ts       # Web dashboard HTTP/WS API
├── onebot-gateway.ts      # OneBot v11 WebSocket server
├── onebot-types.ts        # OneBot protocol types
├── qq-tools.ts            # QQ message sending
├── message-queue.ts       # Debounced message queue
├── middleware/
│   ├── pipeline.ts        # Message processing pipeline
│   ├── ingress.ts         # OneBot → InternalMessage parsing
│   ├── enrich.ts          # Image download & base64 conversion
│   ├── format.ts          # Prompt formatting
│   ├── session-bridge.ts  # OMP session dispatch
│   ├── model-manager.ts   # Model selection & switching
│   ├── respond.ts         # Reply sending via NapCat
│   ├── stream.ts          # Streaming reply manager
│   └── types.ts           # Shared types

### Key dependencies

| Package | Role |
|---|---|
| `@oh-my-pi/pi-agent-core` | Agent runtime, tool calling, session state |
| `@oh-my-pi/pi-ai` | Multi-provider LLM client with streaming |
| `@oh-my-pi/pi-catalog` | Model catalog, provider descriptors, model router |
| `@oh-my-pi/pi-utils` | Logger, dirs, prompt template engine |

---

## Upstream

This is a fork of [oh-my-pi](https://github.com/can1357/oh-my-pi) by [can1357](https://github.com/can1357), which is a fork of [Pi](https://github.com/badlogic/pi-mono) by [mariozechner](https://github.com/mariozechner).

Merging upstream frequently:

```bash
git remote add upstream https://github.com/can1357/oh-my-pi.git
git fetch upstream
git merge upstream/main
bun install
```

---

## License

AGPL-3.0 — see [LICENSE](LICENSE).
