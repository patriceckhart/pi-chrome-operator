/**
 * Pi RPC Bridge Server
 *
 * Spawns `pi --mode rpc --no-session --extension server/extension.ts`
 * and exposes it over WebSocket so the Chrome extension can talk to Pi.
 *
 * The Pi extension (server/extension.ts) registers a `browser_action` tool.
 * When Pi calls that tool, the extension makes an HTTP POST to this bridge,
 * which forwards the action to the Chrome extension over WebSocket and
 * returns the result.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import readline from "node:readline"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

const PORT = Number(process.env.PORT ?? 9224)
const EXTENSION_PATH = path.join(__dirname, "extension.ts")

// ── Pi RPC process ──────────────────────────────────────────────────────────

let pi: ChildProcess | null = null
let piRL: readline.Interface | null = null
let activeSocket: WebSocket | null = null

// Pending browser action requests from the Pi extension (HTTP POST → WS → response)
const pendingActions = new Map<string, {
  resolve: (data: unknown) => void
  timer: ReturnType<typeof setTimeout>
}>()
let actionCounter = 0

function startPi() {
  if (pi) return

  console.log("[bridge] spawning pi --mode rpc --no-session --no-tools --extension", EXTENSION_PATH)
  pi = spawn("pi", ["--mode", "rpc", "--no-session", "--no-tools", "--extension", EXTENSION_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PI_CHROME_BRIDGE_PORT: String(PORT) },
    cwd: ROOT,
  })

  pi.stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[pi stderr] ${d}`)
  })

  piRL = readline.createInterface({ input: pi.stdout! })
  piRL.on("line", (line: string) => {
    try {
      const ev = JSON.parse(line)
      if (ev.type === "message_update") {
        const d = ev.assistantMessageEvent
        if (d?.type === "text_delta") process.stdout.write(d.delta)
      } else {
        console.log(`[pi → ext] ${ev.type}${ev.type === "extension_ui_request" ? ` (method: ${ev.method}, id: ${ev.id})` : ""}`)
      }

      // Handle extension_ui_request: fire-and-forget methods get auto-acked,
      // dialog methods (confirm, select, input, editor) are forwarded to the extension.
      if (ev.type === "extension_ui_request") {
        const fireAndForget = ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]
        if (fireAndForget.includes(ev.method)) {
          if (activeSocket?.readyState === WebSocket.OPEN) {
            activeSocket.send(line)
          }
          return
        }
        // Dialog methods: forward to extension and wait for response
        if (activeSocket?.readyState === WebSocket.OPEN) {
          activeSocket.send(line)
        } else {
          console.log(`[bridge] no extension connected, auto-responding to ${ev.method} (id: ${ev.id})`)
          const autoResponse = getAutoResponse(ev)
          sendToPi(autoResponse)
        }
        return
      }
    } catch {
      // non-JSON, ignore
    }

    // Forward every event from Pi → WebSocket client
    if (activeSocket?.readyState === WebSocket.OPEN) {
      activeSocket.send(line)
    }
  })

  pi.on("exit", (code) => {
    console.log(`[bridge] pi exited with code ${code}`)
    pi = null
    piRL = null
  })
}

/**
 * Generate an auto-response for extension_ui_request when the extension isn't connected.
 */
function getAutoResponse(ev: { id: string; method: string }): object {
  switch (ev.method) {
    case "confirm":
      return { type: "extension_ui_response", id: ev.id, confirmed: true }
    case "select":
      return { type: "extension_ui_response", id: ev.id, cancelled: true }
    case "input":
      return { type: "extension_ui_response", id: ev.id, cancelled: true }
    case "editor":
      return { type: "extension_ui_response", id: ev.id, cancelled: true }
    default:
      return { type: "extension_ui_response", id: ev.id, cancelled: true }
  }
}

function sendToPi(cmd: object) {
  if (!pi?.stdin?.writable) {
    console.error("[bridge] pi process not ready")
    return
  }
  const line = JSON.stringify(cmd)
  console.log(`[ext → pi] ${(cmd as { type?: string }).type ?? "?"}`)
  pi.stdin.write(line + "\n")
}

function killPi() {
  if (pi) {
    pi.kill()
    pi = null
    piRL = null
  }
}

// ── HTTP request handlers ───────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

/**
 * Handle POST /browser-action
 * Called by the Pi extension's browser_action tool.
 * Forwards the action to the Chrome extension via WebSocket and waits for result.
 */
async function handleBrowserAction(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readBody(req)
    const action = JSON.parse(body)

    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "Chrome extension not connected" }))
      return
    }

    const requestId = `ba-${++actionCounter}`
    const timeout = 30000

    // Send to Chrome extension via WebSocket
    const wsMessage = {
      type: "BROWSER_ACTION_REQUEST",
      requestId,
      action,
    }

    const resultPromise = new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        pendingActions.delete(requestId)
        resolve({ ok: false, error: "Chrome extension did not respond within 30s" })
      }, timeout)

      pendingActions.set(requestId, { resolve, timer })
    })

    activeSocket.send(JSON.stringify(wsMessage))
    console.log(`[bridge] browser_action → chrome: ${action.type}${action.tabId ? ` (tab ${action.tabId})` : ""} [${requestId}]`)

    const result = await resultPromise
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: false, error: String(err) }))
  }
}

// ── HTTP + WebSocket server ─────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // CORS headers for all requests
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  // POST /browser-action — from Pi extension
  if (req.method === "POST" && req.url === "/browser-action") {
    void handleBrowserAction(req, res)
    return
  }

  // GET / — health check
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({
    status: "ok",
    pi: pi ? "running" : "stopped",
    chrome: activeSocket?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
  }))
})

const wss = new WebSocketServer({ server: httpServer })

wss.on("connection", (ws) => {
  console.log("[bridge] extension connected")
  activeSocket = ws

  // Start Pi if not already running
  startPi()

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      // Handle browser action results from Chrome extension
      if (msg.type === "BROWSER_ACTION_RESULT") {
        const pending = pendingActions.get(msg.requestId)
        if (pending) {
          clearTimeout(pending.timer)
          pendingActions.delete(msg.requestId)
          pending.resolve(msg.result)
        }
        return
      }

      // Special: restart Pi session
      if (msg.type === "restart") {
        killPi()
        startPi()
        ws.send(JSON.stringify({ type: "response", command: "restart", success: true }))
        return
      }

      // Everything else → forward to Pi RPC
      sendToPi(msg)
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", error: String(err) }))
    }
  })

  ws.on("close", () => {
    console.log("[bridge] extension disconnected")
    activeSocket = null
    // Fail all pending actions
    for (const [id, pending] of pendingActions) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: "Chrome extension disconnected" })
      pendingActions.delete(id)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[bridge] Pi RPC bridge listening on ws://localhost:${PORT}`)
  console.log(`[bridge] HTTP endpoint: http://localhost:${PORT}/browser-action`)
  console.log(`[bridge] Connect from Chrome extension to start chatting with Pi`)
})

// Cleanup
process.on("SIGINT", () => {
  killPi()
  process.exit(0)
})
process.on("SIGTERM", () => {
  killPi()
  process.exit(0)
})
