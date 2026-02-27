#!/usr/bin/env node

/**
 * pi-chrome CLI
 *
 * Usage:
 *   pi-chrome start   — start the bridge server (background daemon)
 *   pi-chrome stop    — stop the bridge server
 *   pi-chrome status  — check if the bridge is running
 *   pi-chrome logs    — tail the bridge logs
 *   pi-chrome ext     — print path to the built Chrome extension
 */

import { spawn, execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import http from "node:http"
import https from "node:https"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

const PID_DIR = path.join(process.env.HOME ?? "/tmp", ".pi-chrome")
const PID_FILE = path.join(PID_DIR, "bridge.pid")
const LOG_FILE = path.join(PID_DIR, "bridge.log")
const PORT = Number(process.env.PORT ?? 9224)

const command = process.argv[2]

function getLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"))
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1
  }
  return 0
}

function checkForUpdate() {
  return new Promise((resolve) => {
    const local = getLocalVersion()

    const options = {
      hostname: "api.github.com",
      path: "/repos/patriceckhart/pi-chrome-operator/tags?per_page=1",
      headers: { "User-Agent": "pi-chrome-cli" },
    }

    const req = https.get(options, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => {
        try {
          const tags = JSON.parse(data)
          if (Array.isArray(tags) && tags.length > 0) {
            const latest = tags[0].name?.replace(/^v/, "") ?? ""
            if (latest && compareVersions(local, latest) < 0) {
              console.log("")
              console.log(`  UPDATE AVAILABLE: v${local} -> v${latest}`)
              console.log(`  Run: npm install -g github:patriceckhart/pi-chrome-operator`)
              console.log("")
            }
          }
        } catch {
          // silently ignore
        }
        resolve()
      })
    })
    req.on("error", () => resolve())
    req.setTimeout(3000, () => { req.destroy(); resolve() })
  })
}

function ensureDir() {
  if (!fs.existsSync(PID_DIR)) {
    fs.mkdirSync(PID_DIR, { recursive: true })
  }
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10)
    if (isNaN(pid)) return null
    try {
      process.kill(pid, 0)
      return pid
    } catch {
      fs.unlinkSync(PID_FILE)
      return null
    }
  } catch {
    return null
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}`, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => {
        try {
          const json = JSON.parse(data)
          resolve(json.status === "ok")
        } catch {
          resolve(false)
        }
      })
    })
    req.on("error", () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function start() {
  ensureDir()

  const existing = readPid()
  if (existing) {
    const healthy = await checkHealth()
    if (healthy) {
      console.log(`+ Bridge already running (PID ${existing}) on ws://localhost:${PORT}`)
      return
    }
    try { process.kill(existing, "SIGTERM") } catch {}
  }

  const logFd = fs.openSync(LOG_FILE, "a")
  const bridgePath = path.join(ROOT, "server", "bridge.ts")

  // Find tsx binary — try local first, then global
  let tsxBin
  const localTsx = path.join(ROOT, "node_modules", ".bin", "tsx")
  if (fs.existsSync(localTsx)) {
    tsxBin = localTsx
  } else {
    try {
      tsxBin = execSync("which tsx", { encoding: "utf-8" }).trim()
    } catch {
      console.error("ERROR: tsx not found. Run: npm install -g tsx")
      process.exit(1)
    }
  }

  const child = spawn(tsxBin, [bridgePath], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  })

  child.unref()
  fs.closeSync(logFd)

  if (child.pid) {
    fs.writeFileSync(PID_FILE, String(child.pid))

    await new Promise((r) => setTimeout(r, 1500))
    const healthy = await checkHealth()

    if (healthy) {
      console.log(`+ Bridge started (PID ${child.pid})`)
      console.log(`   WebSocket: ws://localhost:${PORT}`)
      console.log(`   Logs:      ${LOG_FILE}`)
      console.log(`   Extension: ${path.join(ROOT, "dist")}`)
    } else {
      console.log(`WARNING: Bridge spawned (PID ${child.pid}) but not responding yet.`)
      console.log(`   Check logs: cat ${LOG_FILE}`)
    }
  } else {
    console.error("ERROR: Failed to spawn bridge process")
    process.exit(1)
  }
}

function stop() {
  const pid = readPid()
  if (!pid) {
    console.log("- Bridge is not running")
    return
  }
  try {
    process.kill(pid, "SIGTERM")
    try { fs.unlinkSync(PID_FILE) } catch {}
    console.log(`- Bridge stopped (PID ${pid})`)
  } catch (err) {
    console.error(`ERROR: Failed to stop bridge: ${err}`)
    try { fs.unlinkSync(PID_FILE) } catch {}
  }
}

async function status() {
  const pid = readPid()
  const healthy = await checkHealth()
  if (pid && healthy) {
    console.log(`+ Bridge running (PID ${pid}) on ws://localhost:${PORT}`)
  } else if (pid) {
    console.log(`WARNING: Bridge process exists (PID ${pid}) but not responding`)
  } else {
    console.log("- Bridge is not running")
  }
}

function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log("No logs yet. Start the bridge first: pi-chrome start")
    return
  }
  const tail = spawn("tail", ["-f", "-n", "50", LOG_FILE], { stdio: "inherit" })
  process.on("SIGINT", () => { tail.kill(); process.exit(0) })
}

function ext() {
  const distPath = path.join(ROOT, "dist")
  if (!fs.existsSync(distPath)) {
    console.log("ERROR: Extension not built yet. Run: pi-chrome build")
    process.exit(1)
  }
  console.log(distPath)
}

function help() {
  console.log(`
pi-chrome — Pi Chrome Operator bridge

Usage:
  pi-chrome start    Start the bridge server (background)
  pi-chrome stop     Stop the bridge server
  pi-chrome status   Check if the bridge is running
  pi-chrome logs     Tail bridge logs
  pi-chrome ext      Print Chrome extension path

Environment:
  PORT               Bridge port (default: 9224)
`)
}

switch (command) {
  case "start":  await start(); await checkForUpdate(); break
  case "stop":   stop(); break
  case "status": await status(); await checkForUpdate(); break
  case "logs":   logs(); break
  case "ext":    ext(); break
  default:       help(); break
}
