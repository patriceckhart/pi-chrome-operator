# Changelog

## 0.0.10

_(0.0.9 was previously published and unpublished on npm, so npm blocks re-use of that version)_

### Native Pi tool integration (replaces prompt-hacked browser actions)

- **`browser_action` registered as a proper Pi custom tool** via `pi.registerTool()` in a Pi extension (`server/extension.ts`)
  - No more `\`\`\`browser-action` code blocks parsed from LLM output
  - No more JSON escaping issues (the Discord selector bug where nested quotes broke JSON.parse)
  - No more regex parsing of assistant responses
  - Pi now gets structured tool call results directly in conversation context
  - Actions and results flow through Pi's native tool call → result cycle
- **Bridge spawns Pi with `--extension server/extension.ts`** — the extension registers the tool and communicates with the bridge via HTTP POST `/browser-action`
- **Bridge relays browser actions**: extension → HTTP POST → bridge → WebSocket → Chrome extension → result back through the chain
- **`before_agent_start` hook** injects browser state (open tabs + active tab context) into Pi's system prompt on every turn

### Multi-tab support

- **All browser actions accept optional `tabId`** — operate on any tab, not just the active one
- **New actions**: `list_tabs`, `new_tab`, `close_tab`, `switch_tab`, `get_tab_context`
- **`list_tabs`** returns all open tabs with IDs, URLs, titles, active status
- **`get_tab_context`** inspects any tab's page (forms, buttons, links, text) by tab ID
- **Background service worker** uses `resolveTab(tabId?)` — routes to specific tab or falls back to active tab
- **Prompt guidelines** teach Pi to list tabs first, inspect before interacting, specify tabId for cross-tab work

### Improved browser action reliability

- **`submitForm` rewritten** for React/Vue/modern framework compatibility
  - Dispatches full Enter key sequence with `which`, `charCode`, `composed` properties
  - Sends `beforeinput` with `insertParagraph` inputType (what React listens for)
  - Proper focus management before key dispatch
- **Empty text + submit no longer clears existing content** — when `text` is empty and `submit` is true, just focuses the element and presses Enter (fixes the Discord "type empty then submit" bug)
- **Simplified App.tsx** — removed all prompt-engineering preamble, `parseBrowserActions`, `runningActions` state, and the action feedback loop. The extension handles everything natively.

### Model selector

- **Model dropdown in the header** — shows all models configured in Pi, with `provider / Model Name` format
- Fetches available models from Pi via `get_available_models` RPC command on connect
- Fetches current model via `get_state` RPC command
- Switching models sends `set_model` RPC command — takes effect immediately
- Active model highlighted with ✦ icon
- **New `sendCommand` method** on the bridge hook — sends an RPC command with a unique `id` and returns a `Promise` that resolves when the correlated response arrives

### Browser operator mode

- **Pi spawned with `--no-tools`** — built-in coding tools (bash, read, write, edit, grep, find, ls) are disabled; only `browser_action` is available
- **Custom system prompt replaces Pi's default** — Pi identifies as a browser operator, not a coding assistant. No more "I need to first understand the project structure" responses to browser requests.
- System prompt includes workflow guidance: inspect page → perform action → verify result

### UI: pure black theme

- Background changed from dark blue/purple (`222.2 84% 4.9%`) to pure black (`0 0% 0%`)
- All color variables shifted to neutral grays — no blue/purple hue anywhere
- Popover background slightly lighter (`0 0% 7%`) for dropdown contrast
- Borders and inputs use subtle neutral gray (`0 0% 15%`)
- Tool message bubbles and avatars changed from amber/brown to neutral gray
- All emojis replaced with Lucide React icons (Globe for tool calls, Check/XCircle for status)

## 0.0.8

- Fixed Pi getting stuck on `extension_ui_request` events from Pi RPC
- Bridge now handles extension UI protocol: forwards dialog requests (confirm, select, input, editor) to extension, auto-responds when extension is disconnected
- Chrome extension responds to `extension_ui_request` events: auto-confirms confirmations, auto-selects first option for selects, cancels input/editor dialogs
- Fire-and-forget extension UI methods (notify, setStatus, setWidget, setTitle) displayed as status messages in chat
- Prevents Pi from hanging indefinitely when extensions request user interaction
- UI theme: changed primary color from purple to white with dark foreground
- User message bubbles, avatar, "live" badge, send button, and focus rings are now white with dark icons/text
- Added workflow_dispatch trigger to CI

## 0.0.6

- Published to npmjs.com: `npm install -g @patriceckhart/pi-chrome-operator`
- CI workflow publishes to both npm and GitHub Packages
- Simplified install command in README

## 0.0.5

- Live version check on `pi-chrome start` and `pi-chrome status`
- Queries GitHub tags API for latest release, compares with local version
- Shows update instructions when a newer version is available
- Silent timeout after 3 seconds, never blocks the CLI

## 0.0.3

- Rich editor support: Monaco Editor, CKEditor 4/5, ProseMirror/Tiptap, TinyMCE
- Contenteditable element support for typing actions
- 3-layer text insertion: editor JS API, keyboard-level InputEvent simulation, execCommand fallback
- Page context now detects and reports rich editor elements
- Main world script execution via chrome.scripting.executeScript (bypasses CSP)
- Background service worker handles EXECUTE_IN_PAGE_WORLD for page-level API access
- Monaco editing uses model.pushEditOperations for non-destructive content replacement
- Code blocks in chat messages rendered with proper styling and syntax labels
- Stop button redesigned as red circle icon
- Assistant avatar matches chat bubble background with white Pi logo

## 0.0.2

- GitHub Packages publishing under @patriceckhart/pi-chrome-operator
- Version bump workflow: auto patch bump, build, publish, tag on every push to main
- Scoped package name for npm registry install
- Screenshot added to README

## 0.0.1

- Initial release
- Chrome Extension with React, Tailwind, shadcn/ui (Manifest V3)
- Side panel and popup with full chat UI
- Pi RPC bridge server over WebSocket (spawns `pi --mode rpc`)
- Browser automation: navigate, click, type, select, scroll, extract, wait
- Content script with page context extraction (URL, text, forms, buttons, links)
- Smart element selectors: id, data-testid, name, aria-label, CSS path fallback
- Click by visible text fallback
- Character-by-character typing simulation
- Browser action parsing from Pi responses (```browser-action blocks)
- Action results fed back to Pi with fresh page context
- Image support: paste, drag-and-drop, upload, sent as base64 to Pi
- Image previews in chat messages and input area
- Saved routines with built-in presets (check mail, summarize page, fill form, find contact)
- Custom routine creation and deletion
- Settings panel (bridge URL, auto-run toggle)
- Dark mode only UI
- Pi logo (official badlogic SVG) in header, chat avatars, welcome screen
- Extension icons: black background, white Pi logo
- Stop button: aborts Pi streaming and cancels running browser actions
- Connection status badge with auto-reconnect
- New session button
- Page inspect button
- `pi-chrome` CLI: start, stop, status, logs, ext
- Background daemon with PID tracking in ~/.pi-chrome/
- Postinstall script for automatic build on `npm install -g`
- Global install via `npm install -g github:patriceckhart/pi-chrome-operator`
