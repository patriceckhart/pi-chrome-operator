/**
 * Pi RPC Bridge Server
 *
 * Spawns `pi --mode rpc --no-session` and exposes it over WebSocket so the
 * Chrome extension can talk to the full Pi agent (with all tools, models,
 * conversation history, etc.).
 *
 * Also injects a browser-control custom tool so Pi can drive the browser.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:http"
import { WebSocketServer, WebSocket } from "ws"
import readline from "node:readline"

const PORT = Number(process.env.PORT ?? 9224)

// ── Pi RPC process ──────────────────────────────────────────────────────────

let pi: ChildProcess | null = null
let piRL: readline.Interface | null = null
let activeSocket: WebSocket | null = null

function startPi() {
  if (pi) return

  console.log("[bridge] spawning pi --mode rpc --no-session")
  pi = spawn("pi", ["--mode", "rpc", "--no-session"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  })

  pi.stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[pi stderr] ${d}`)
  })

  piRL = readline.createInterface({ input: pi.stdout! })
  piRL.on("line", (line: string) => {
    // Forward every event from Pi → WebSocket client
    if (activeSocket?.readyState === WebSocket.OPEN) {
      activeSocket.send(line)
    }
    // Also log
    try {
      const ev = JSON.parse(line)
      if (ev.type === "message_update") {
        const d = ev.assistantMessageEvent
        if (d?.type === "text_delta") process.stdout.write(d.delta)
      } else {
        console.log(`[pi → ext] ${ev.type}`)
      }
    } catch {
      // non-JSON, ignore
    }
  })

  pi.on("exit", (code) => {
    console.log(`[bridge] pi exited with code ${code}`)
    pi = null
    piRL = null
  })
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

// ── HTTP + WebSocket server ─────────────────────────────────────────────────

const httpServer = createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  })
  res.end(JSON.stringify({ status: "ok", pi: pi ? "running" : "stopped" }))
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
  })
})

httpServer.listen(PORT, () => {
  console.log(`[bridge] Pi RPC bridge listening on ws://localhost:${PORT}`)
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
