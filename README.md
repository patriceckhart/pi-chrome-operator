# Pi Chrome Operator

**Let [badlogic's pi](https://pi.dev) take the wheel in your browser.**

![Pi Chrome Operator](docs/screenshot.png?v=3) Summarize pages, fill forms, navigate sites, check mail — all via natural language across all your browser tabs. Save routines for tasks you repeat.

## How it works

```
Chrome Extension (React + shadcn) <-> WebSocket <-> Pi Bridge Server <-> Pi RPC (local)
        |                                              |                      |
  Content Script                               HTTP /browser-action    Pi + Extension
  (page actions)                               (tool ↔ bridge relay)   (browser_action tool)
```

1. **Pi Extension** (`server/extension.ts`) — registers a `browser_action` tool via `pi.registerTool()`, so the LLM calls it natively like any other tool
2. **Pi Bridge Server** — spawns `pi --mode rpc --no-tools --extension server/extension.ts`, relays WebSocket ↔ Pi RPC, and serves HTTP `/browser-action` for the extension to reach the Chrome side
3. **Chrome Extension** — side panel with chat UI, handles `BROWSER_ACTION_REQUEST` messages from the bridge, executes them via Chrome APIs and content scripts
4. **Content Script** — runs on every page, executes DOM-level actions (click, type, scroll, extract) and provides page context

Browser actions flow through Pi's native tool system: the LLM decides to call `browser_action` → Pi executes the extension tool → the extension POSTs to the bridge → the bridge sends it over WebSocket to Chrome → Chrome executes and returns the result → the tool returns structured output to the LLM. No prompt engineering or regex parsing.

## Install

```bash
pi install npm:@patriceckhart/pi-chrome-operator
```

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

Click the Chrome Operator icon in Chrome, the side panel opens, chat away.

## CLI

```bash
pi-chrome start    # start bridge in background
pi-chrome stop     # stop bridge
pi-chrome status   # check if running
pi-chrome logs     # tail bridge logs
pi-chrome ext      # print Chrome extension path
```

## Features

### Dedicated Browser Agent
Pi runs as a focused browser operator — built-in coding tools are disabled, and the system prompt is tailored for browser interaction. Pi won't try to explore your filesystem; it goes straight to using `browser_action`.

### Model Selector
Switch between any of your configured models directly from the extension header. Shows `provider / Model Name` with the active model highlighted.

### Image Support
Paste, drag-and-drop, or upload images. Pi can see and analyze them.

### Multi-Tab Browser Control
Pi can see and control **all** your browser tabs, not just the active one. The `browser_action` tool is registered natively with Pi, so the LLM calls it as a structured tool with proper argument validation and gets results directly in context.

Available actions:

| Action | Description |
|--------|-------------|
| `list_tabs` | List all open tabs with IDs, URLs, titles |
| `get_tab_context` | Inspect a tab's page — forms, buttons, links, text |
| `navigate` | Go to a URL (in any tab) |
| `click` | Click elements by CSS selector or visible text |
| `type` | Type into form fields, with optional submit |
| `select` | Choose dropdown options |
| `scroll` | Scroll the page up or down |
| `extract` | Read text content from elements |
| `new_tab` | Open a URL in a new tab |
| `switch_tab` | Activate a tab by ID |
| `close_tab` | Close a tab by ID |
| `wait` | Pause between actions |

All actions accept an optional `tabId` to target a specific tab. Pi automatically gets the list of open tabs and active tab context at the start of every turn.

### Rich Editor Support
Works with Monaco Editor, CKEditor 4/5, ProseMirror/Tiptap, TinyMCE, and contenteditable elements. Three-layer text insertion: editor JS API → keyboard-level InputEvent simulation → execCommand fallback.

### Saved Routines
Save prompts as routines for one-click execution. Create your own for any repeated task.

### Settings
- Configure pi bridge URL

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
  pi-chrome.ts       # CLI (start/stop/status/logs/ext)
server/
  bridge.ts          # Pi RPC bridge — WebSocket relay + HTTP /browser-action
  extension.ts       # Pi extension — registers browser_action tool
src/
  background.ts      # Chrome service worker — tab management, action routing
  content.ts         # Page action executor + page context extraction
  manifest.ts        # Chrome extension manifest
  types.ts           # Shared types (BrowserAction, TabInfo, etc.)
  ui/
    App.tsx           # Main chat UI with model selector
    ChatMessage.tsx   # Message bubbles with image + code block support
    RoutinePanel.tsx
    SettingsPanel.tsx
  hooks/
    usePiBridge.ts    # WebSocket connection + browser action handler
    useRoutines.ts    # Routine storage
    useSettings.ts
  components/         # shadcn/ui components
dist/                 # Built Chrome extension
```

## Requirements

- Node.js 18+
- Chrome 116+ (for side panel API)
- [Pi CLI](https://github.com/mariozechner/pi) installed and configured
- At least one AI provider API key configured in Pi

## License

MIT
