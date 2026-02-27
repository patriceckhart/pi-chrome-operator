# Changelog

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
