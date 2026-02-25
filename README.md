# Pi Chrome Operator

**Chat with Pi AI to control your browser.** Summarize pages, fill forms, navigate sites, check mail — all via natural language. Save routines for tasks you repeat.

![Architecture](docs/architecture.png)

## How it works

```
Chrome Extension (React + shadcn) ←→ WebSocket ←→ Pi Bridge Server ←→ Pi RPC (local)
        ↓                                                                    ↓
  Content Script                                                    Your AI models
  (browser actions)                                              (Anthropic, OpenAI, etc.)
```

1. **Chrome Extension** — side panel / popup with chat UI
2. **Pi Bridge Server** — small Node.js server that spawns `pi --mode rpc` and relays via WebSocket
3. **Pi Agent** — full Pi with all tools, models, and conversation history
4. **Content Script** — executes browser actions (click, type, navigate, extract) on the active tab

## Quick Start

### 1. Install globally

```bash
# From the project directory
npm install
npm run build
npm link
```

### 2. Load extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the path from `pi-chrome ext`

### 3. Start / stop the bridge

```bash
pi-chrome start    # start bridge in background
pi-chrome stop     # stop bridge
pi-chrome status   # check if running
pi-chrome logs     # tail bridge logs
pi-chrome ext      # print extension path
```

> **Prerequisite:** You need `pi` installed and configured with at least one API key.
> Run `pi` once in your terminal to set it up.

### 4. Use it!

- Click the Pi icon in Chrome → opens the side panel
- Chat with Pi normally ("What's the capital of France?")
- Ask Pi to interact with the page ("Click the login button", "Fill in the form with my name John")
- Use routines for repeated tasks ("Check my Gmail and summarize")

## Features

### 💬 Full Pi Chat
Talk to Pi like you normally would — it has access to all its tools (read, bash, edit, write) through the bridge.

### 🌐 Browser Control
Pi can see the current page (URL, text, forms, buttons, links) and execute actions:
- **navigate** — go to a URL
- **click** — click elements by CSS selector or visible text
- **type** — fill in form fields
- **select** — choose dropdown options
- **scroll** — scroll the page
- **extract** — read text content
- **wait** — pause between actions

### 📋 Saved Routines
Save prompts as routines for one-click execution:
- 📬 **Check my mails** — opens Gmail, summarizes important messages
- 📝 **Summarize this page** — reads and summarizes current page
- 📋 **Help me fill this form** — analyzes form fields and assists
- 🔍 **Find contact info** — finds emails, phones, addresses on current site

Create your own routines for any repeated task.

### ⚙️ Settings
- Configure bridge URL
- Toggle auto-run for browser actions

## Development

```bash
# Dev mode with HMR (for UI development)
npm run dev

# Build extension
npm run build:ext

# Run bridge server
npm run bridge

# Or with custom port
PORT=8888 npm run bridge
```

## Project Structure

```
├── server/
│   └── bridge.ts          # Pi RPC bridge (WebSocket relay)
├── src/
│   ├── background.ts      # Chrome service worker
│   ├── content.ts         # Page action executor
│   ├── manifest.ts        # Chrome extension manifest
│   ├── types.ts           # Shared types
│   ├── popup.tsx           # Popup entry
│   ├── sidepanel.tsx       # Side panel entry
│   ├── ui/
│   │   ├── App.tsx         # Main chat UI
│   │   ├── ChatMessage.tsx # Message bubble component
│   │   ├── RoutinePanel.tsx # Saved routines
│   │   └── SettingsPanel.tsx
│   ├── hooks/
│   │   ├── usePiBridge.ts  # WebSocket connection to bridge
│   │   ├── useRoutines.ts  # Routine storage
│   │   └── useSettings.ts  # Settings storage
│   ├── components/ui/      # shadcn components
│   └── lib/utils.ts
├── popup.html
├── sidepanel.html
└── dist/                   # Built extension (load this in Chrome)
```

## Requirements

- Node.js 18+
- Chrome 116+ (for side panel API)
- `pi` CLI installed and configured (`npm i -g @mariozechner/pi-coding-agent`)
- At least one AI provider API key configured in Pi
