#!/usr/bin/env node

/**
 * postinstall script
 *
 * When installed from GitHub via `npm install -g`, npm only installs
 * production dependencies. We need the devDependencies (vite, react, etc.)
 * to build the Chrome extension. This script:
 *
 *   1. Checks if dist/ already exists (skip if so)
 *   2. Installs devDependencies
 *   3. Runs `vite build` to produce dist/
 *
 * After that, `pi-chrome ext` returns the path to load in Chrome.
 */

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const DIST = path.join(ROOT, "dist")

// If dist/ already exists and has a manifest, skip the build
if (fs.existsSync(path.join(DIST, "manifest.json"))) {
  console.log("[pi-chrome] Extension already built, skipping.")
  process.exit(0)
}

console.log("[pi-chrome] Building Chrome extension...")

try {
  // Install ALL dependencies (including dev) so vite/react/tailwind are available
  console.log("[pi-chrome] Installing build dependencies...")
  execSync("npm install --include=dev --ignore-scripts", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  })

  // Run vite build
  console.log("[pi-chrome] Running vite build...")
  execSync("npx vite build", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env },
  })

  if (fs.existsSync(path.join(DIST, "manifest.json"))) {
    console.log("[pi-chrome] + Extension built successfully!")
    console.log(`[pi-chrome] Load in Chrome: ${DIST}`)
  } else {
    console.error("[pi-chrome] ERROR: Build completed but dist/manifest.json not found")
    process.exit(1)
  }
} catch (err) {
  console.error("[pi-chrome] ERROR: Build failed:", err.message)
  console.error("[pi-chrome] You can build manually: cd $(npm root -g)/pi-chrome-operator && npm install && npm run build")
  process.exit(1)
}
