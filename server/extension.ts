/**
 * Pi Chrome Operator Extension
 *
 * Registers a `browser_action` tool that lets Pi control the browser
 * via the bridge WebSocket → Chrome extension pipeline.
 *
 * Communication: extension → HTTP POST to bridge → WebSocket → Chrome extension
 *
 * This file is loaded by Pi via `pi --extension server/extension.ts`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import http from "node:http"

const BRIDGE_PORT = Number(process.env.PI_CHROME_BRIDGE_PORT ?? 9224)

/**
 * Send a browser action to the bridge and wait for the result.
 */
function callBridge(action: Record<string, unknown>): Promise<{
  ok: boolean
  result?: unknown
  error?: string
  context?: unknown
  tabs?: unknown
}> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(action)
    const req = http.request(
      {
        hostname: "localhost",
        port: BRIDGE_PORT,
        path: "/browser-action",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch {
            reject(new Error(`Bridge returned invalid JSON: ${data.slice(0, 200)}`))
          }
        })
      }
    )
    req.on("error", (err) => {
      reject(new Error(`Bridge not reachable at localhost:${BRIDGE_PORT}: ${err.message}`))
    })
    req.setTimeout(30000, () => {
      req.destroy()
      reject(new Error("Bridge request timed out (30s)"))
    })
    req.write(body)
    req.end()
  })
}

function formatPageContext(ctx: {
  url?: string
  title?: string
  inputs?: { selector: string; type: string; name: string; placeholder: string; value: string }[]
  buttons?: { selector: string; text: string }[]
  links?: { text: string; href: string }[]
  text?: string
}): string {
  let out = ""
  if (ctx.url) out += `URL: ${ctx.url}\n`
  if (ctx.title) out += `Title: ${ctx.title}\n`
  if (ctx.inputs?.length) {
    out += `\nForm inputs:\n`
    for (const i of ctx.inputs) {
      out += `  - ${i.selector} (${i.type}) name="${i.name}" placeholder="${i.placeholder}"`
      if (i.value) out += ` value="${i.value.slice(0, 100)}"`
      out += "\n"
    }
  }
  if (ctx.buttons?.length) {
    out += `\nButtons:\n`
    for (const b of ctx.buttons) {
      out += `  - ${b.selector}: "${b.text}"\n`
    }
  }
  if (ctx.links?.length) {
    out += `\nLinks (first 20):\n`
    for (const l of ctx.links.slice(0, 20)) {
      out += `  - "${l.text}" → ${l.href}\n`
    }
  }
  if (ctx.text) {
    out += `\nPage text (excerpt):\n${ctx.text.slice(0, 4000)}\n`
  }
  return out
}

function formatTabs(tabs: { tabId: number; url: string; title: string; active: boolean }[]): string {
  let out = "Open tabs:\n"
  for (const t of tabs) {
    out += `  - [${t.tabId}] ${t.active ? "(active) " : ""}${t.title || "(no title)"} — ${t.url}\n`
  }
  return out
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_action",
    label: "Browser Action",
    description:
      "Control the Chrome browser: navigate pages, click elements, type text, manage tabs, and extract page content. Operates on any tab by specifying tabId.",
    promptSnippet:
      "Navigate, click, type, scroll, extract content, manage tabs — full browser control across all open tabs",
    promptGuidelines: [
      "Use browser_action to interact with web pages in Chrome.",
      'Use action "list_tabs" first to see all open tabs and their IDs.',
      'Use action "get_tab_context" to inspect a specific tab\'s page (inputs, buttons, links, text). Always do this before interacting with a tab you haven\'t inspected yet.',
      "Specify tabId to operate on a specific tab. Omit tabId to use the currently active tab.",
      'For typing into inputs, use the selector from the page context. Set submit=true to press Enter after typing.',
      'Use action "new_tab" to open URLs in new tabs, "switch_tab" to activate a tab, "close_tab" to close one.',
      "After performing actions that change page state (click, type, navigate), use get_tab_context to verify the result.",
    ],
    parameters: Type.Object({
      action: StringEnum([
        "navigate",
        "click",
        "type",
        "select",
        "scroll",
        "extract",
        "get_tab_context",
        "list_tabs",
        "new_tab",
        "close_tab",
        "switch_tab",
        "wait",
      ] as const),
      // Optional fields — which ones are used depends on the action
      url: Type.Optional(Type.String({ description: "URL for navigate or new_tab" })),
      selector: Type.Optional(Type.String({ description: "CSS selector for click, type, select, extract" })),
      text: Type.Optional(Type.String({ description: "Text to type, or visible text for click fallback" })),
      value: Type.Optional(Type.String({ description: "Value for select dropdown" })),
      submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing (default: false)" })),
      direction: Type.Optional(StringEnum(["up", "down"] as const)),
      amount: Type.Optional(Type.Number({ description: "Scroll amount in pixels (default: 400)" })),
      tabId: Type.Optional(Type.Number({ description: "Target tab ID. Omit for active tab." })),
      ms: Type.Optional(Type.Number({ description: "Wait duration in milliseconds" })),
    }),

    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Aborted" }] }
      }

      const action = params.action

      try {
        // Build the action payload to send to the bridge
        const payload: Record<string, unknown> = { type: action }

        if (params.tabId != null) payload.tabId = params.tabId
        if (params.url != null) payload.url = params.url
        if (params.selector != null) payload.selector = params.selector
        if (params.text != null) payload.text = params.text
        if (params.value != null) payload.value = params.value
        if (params.submit != null) payload.submit = params.submit
        if (params.direction != null) payload.direction = params.direction
        if (params.amount != null) payload.amount = params.amount
        if (params.ms != null) payload.ms = params.ms

        const res = await callBridge(payload)

        if (!res.ok) {
          throw new Error(res.error ?? "Action failed")
        }

        // Format the result based on action type
        let resultText = ""

        if (action === "list_tabs" && res.result && typeof res.result === "object" && "tabs" in (res.result as object)) {
          const tabs = (res.result as { tabs: { tabId: number; url: string; title: string; active: boolean }[] }).tabs
          resultText = formatTabs(tabs)
        } else if (action === "get_tab_context" && res.context) {
          const ctx = res.context as {
            url?: string; title?: string
            inputs?: { selector: string; type: string; name: string; placeholder: string; value: string }[]
            buttons?: { selector: string; text: string }[]
            links?: { text: string; href: string }[]
            text?: string
          }
          resultText = formatPageContext(ctx)
        } else if (res.result) {
          resultText = `Success: ${JSON.stringify(res.result)}`
        } else {
          resultText = "Action completed successfully."
        }

        return {
          content: [{ type: "text", text: resultText }],
          details: { action, params, result: res.result },
        }
      } catch (err) {
        throw new Error(`browser_action(${action}) failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  // Replace system prompt and inject browser context on every turn
  pi.on("before_agent_start", async () => {
    let browserState = ""
    try {
      // Get list of tabs
      const tabsRes = await callBridge({ type: "list_tabs" })
      if (tabsRes.ok && tabsRes.result && typeof tabsRes.result === "object" && "tabs" in (tabsRes.result as object)) {
        const tabs = (tabsRes.result as { tabs: { tabId: number; url: string; title: string; active: boolean }[] }).tabs
        browserState += "\n[Browser state]\n" + formatTabs(tabs)
      }

      // Get active tab context
      const ctxRes = await callBridge({ type: "get_tab_context" })
      if (ctxRes.ok && ctxRes.context) {
        browserState += "\n[Active tab details]\n" + formatPageContext(ctxRes.context as {
          url?: string; title?: string
          inputs?: { selector: string; type: string; name: string; placeholder: string; value: string }[]
          buttons?: { selector: string; text: string }[]
          links?: { text: string; href: string }[]
          text?: string
        })
      }
    } catch {
      // Bridge may not be running yet, that's fine
    }

    const systemPrompt = `You are a browser operator. You control a real Chrome browser using the browser_action tool. You MUST use the browser to fulfill user requests — navigate to websites, search, click, type, and interact with real web pages.

CRITICAL RULES:
- You MUST use the browser_action tool for ANY request involving websites, searching, finding products, checking information online, etc.
- NEVER answer from your own knowledge when the user wants you to do something on a website. Actually go to the website and do it.
- If the user says "find X on Amazon", you MUST navigate to amazon.com, type in the search box, and search. Do NOT just provide a URL or answer from memory.
- If the user says "check my email", you MUST navigate to the email site and read it.
- Only answer without tools for purely conversational questions like "how are you" or "what can you do".

WORKFLOW for browser tasks:
1. Navigate to the website using action "navigate"
2. Use action "get_tab_context" to see the page elements (inputs, buttons, links)
3. Interact with the page (click, type, select, etc.) using CSS selectors from the page context
4. Verify the result with another get_tab_context call
5. Report what you found/did to the user

IMPORTANT:
- Always inspect a page with get_tab_context before trying to click or type on it
- Use CSS selectors from the page context for click/type actions
- For typing into search fields, set submit=true to press Enter after typing
- You can operate on any tab by specifying tabId
- For multi-step tasks, perform actions one at a time and check results between steps
${browserState}`

    return { systemPrompt }
  })
}
