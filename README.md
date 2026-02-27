# Pi Chrome Operator

**Let [badlogic's pi](https://pi.dev) take the wheel in your browser.**

![Pi Chrome Operator](docs/screenshot.png?v=2) Summarize pages, fill forms, navigate sites, check mail - all via natural language. Save routines for tasks you repeat.

## How it works

```
Chrome Extension (React + shadcn) <-> WebSocket <-> Pi Bridge Server <-> Pi RPC (local)
        |                                                                    |
  Content Script                                                    Your AI models
  (browser actions)                                              (Anthropic, OpenAI, etc.)
```

1. **Chrome Extension** - side panel / popup with chat UI
2. **Pi Bridge Server** - small Node.js server that spawns `pi --mode rpc` and relays via WebSocket
3. **Pi Agent** - full Pi with all tools, models, and conversation history
4. **Content Script** - executes browser actions (click, type, navigate, extract) on the active tab

## Install

```bash
npm install -g @patriceckhart/pi-chrome-operator --registry=https://npm.pkg.github.com
```

Or directly from GitHub:

```bash
npm install -g github:patriceckhart/pi-chrome-operator
```

This installs the `pi-chrome` CLI globally and automatically builds the Chrome extension.

> **Prerequisite:** You need [Pi](https://github.com/mariozechner/pi) installed and configured with at least one API key.
> ```bash
> npm install -g @mariozechner/pi-coding-agent
> pi  # run once to configure
> ```

## Setup

### 1. Load extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the path from:
   ```bash
   pi-chrome ext
   ```

### 2. Start the bridge

```bash
pi-chrome start
```

### 3. Use it!

Click the Pi icon in Chrome, the side panel opens, chat away.

## CLI

```bash
pi-chrome start    # start bridge in background
pi-chrome stop     # stop bridge
pi-chrome status   # check if running
pi-chrome logs     # tail bridge logs
pi-chrome ext      # print Chrome extension path
```

## Features

### Full Pi Chat
Chat with Pi like normal - full access to all tools (read, bash, edit, write) and your configured AI models.

### Image Support
Paste, drag-and-drop, or upload images. Pi can see and analyze them.

### Browser Control
Pi can see the current page and execute actions:
- **navigate** - go to a URL
- **click** - click elements by CSS selector or visible text
- **type** - fill in form fields
- **select** - choose dropdown options
- **scroll** - scroll the page
- **extract** - read text content
- **wait** - pause between actions

### Saved Routines
Save prompts as routines for one-click execution:
- **Check my mails** - opens Gmail, summarizes important messages
- **Summarize this page** - reads and summarizes current page
- **Help me fill this form** - analyzes form fields and assists
- **Find contact info** - finds emails, phones, addresses

Create your own routines for any repeated task.

### Settings
- Configure bridge URL
- Toggle auto-run for browser actions

## Development

```bash
git clone https://github.com/patriceckhart/pi-chrome-operator.git
cd pi-chrome-operator
npm install
npm run build

# Dev mode with HMR
npm run dev

# Or link globally for CLI
npm link
```

## Project Structure

```
bin/
  pi-chrome.js       # CLI (start/stop/status/logs/ext)
server/
  bridge.ts          # Pi RPC bridge (WebSocket relay)
src/
  background.ts      # Chrome service worker
  content.ts         # Page action executor + page context
  manifest.ts        # Chrome extension manifest
  types.ts           # Shared types
  ui/
    App.tsx           # Main chat UI
    ChatMessage.tsx   # Message bubbles with image support
    RoutinePanel.tsx
    SettingsPanel.tsx
  hooks/
    usePiBridge.ts    # WebSocket connection
    useRoutines.ts    # Routine storage
    useSettings.ts
  components/         # shadcn/ui components
dist/                 # Built Chrome extension
.github/workflows/    # Auto version bump on push
```

## Requirements

- Node.js 18+
- Chrome 116+ (for side panel API)
- [Pi CLI](https://github.com/mariozechner/pi) installed and configured
- At least one AI provider API key configured in Pi

## License

MIT
