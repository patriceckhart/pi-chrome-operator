/**
 * Content script – runs on every page.
 *
 * Handles two things:
 *   1. EXECUTE_ACTION  – perform a browser action (click, type, etc.)
 *   2. GET_PAGE_CONTEXT – return structured info about the current page
 *      so Pi can reason about what's on screen.
 */

import type { BrowserAction, PageContext } from "./types"

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "EXECUTE_ACTION") {
    void executeAction(message.action as BrowserAction)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }))
    return true
  }

  if (message?.type === "GET_PAGE_CONTEXT") {
    const ctx = getPageContext()
    sendResponse({ ok: true, context: ctx })
    return true
  }
})

// ── Page context ────────────────────────────────────────────────────────────

function getPageContext(): PageContext {
  // Collect interactive elements with unique selectors
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input:not([type=hidden]), textarea, select"
  )).slice(0, 50).map((el, i) => {
    const selector = uniqueSelector(el, i, "input")
    return {
      selector,
      type: el.tagName === "SELECT" ? "select" : (el as HTMLInputElement).type || "text",
      name: el.name || "",
      placeholder: (el as HTMLInputElement).placeholder || "",
      value: el.value || "",
    }
  })

  const buttons = Array.from(document.querySelectorAll<HTMLElement>(
    "button, [role=button], input[type=submit], input[type=button], a.btn, a.button"
  )).slice(0, 30).map((el, i) => ({
    selector: uniqueSelector(el, i, "btn"),
    text: el.innerText?.trim().slice(0, 80) || el.getAttribute("aria-label") || "",
  }))

  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .slice(0, 40)
    .map((a) => ({
      text: a.innerText?.trim().slice(0, 60) || "",
      href: a.href,
    }))
    .filter((l) => l.text)

  // Get visible text (trimmed)
  const textContent = document.body?.innerText?.slice(0, 8000) || ""

  return {
    url: location.href,
    title: document.title,
    text: textContent,
    links,
    inputs,
    buttons,
  }
}

function uniqueSelector(el: Element, index: number, prefix: string): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  // Try data-testid
  const testId = el.getAttribute("data-testid")
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`
  // Try name
  const name = el.getAttribute("name")
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
    if (document.querySelectorAll(sel).length === 1) return sel
  }
  // Try aria-label
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) {
    const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`
    if (document.querySelectorAll(sel).length === 1) return sel
  }
  // Fallback: nth-of-type based path
  return buildCssPath(el)
}

function buildCssPath(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body && parts.length < 5) {
    let sel = current.tagName.toLowerCase()
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`)
      break
    }
    const parent = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === current!.tagName)
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1
        sel += `:nth-of-type(${idx})`
      }
    }
    parts.unshift(sel)
    current = parent
  }
  return parts.join(" > ")
}

// ── Action executor ─────────────────────────────────────────────────────────

async function executeAction(action: BrowserAction): Promise<unknown> {
  switch (action.type) {
    case "navigate": {
      location.href = action.url
      return { navigated: action.url }
    }

    case "click": {
      let el: HTMLElement | null = null
      if (action.selector) {
        el = document.querySelector(action.selector)
      }
      // Fallback: find by visible text
      if (!el && action.text) {
        el = findByText(action.text)
      }
      if (!el) throw new Error(`Element not found: ${action.selector || action.text}`)
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      await delay(300)
      el.click()
      return { clicked: action.selector || action.text }
    }

    case "type": {
      const el = document.querySelector(action.selector) as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) throw new Error(`Input not found: ${action.selector}`)
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.focus()
      // Clear existing value
      el.value = ""
      el.dispatchEvent(new Event("input", { bubbles: true }))
      // Type character by character (more realistic)
      for (const char of action.text) {
        el.value += char
        el.dispatchEvent(new Event("input", { bubbles: true }))
        await delay(20 + Math.random() * 30)
      }
      el.dispatchEvent(new Event("change", { bubbles: true }))
      if (action.submit) {
        await delay(200)
        const form = el.closest("form")
        if (form) form.requestSubmit()
        else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      }
      return { typed: action.selector, text: action.text }
    }

    case "select": {
      const el = document.querySelector(action.selector) as HTMLSelectElement | null
      if (!el) throw new Error(`Select not found: ${action.selector}`)
      el.value = action.value
      el.dispatchEvent(new Event("change", { bubbles: true }))
      return { selected: action.value }
    }

    case "wait": {
      await delay(action.ms)
      return { waited: action.ms }
    }

    case "scroll": {
      const amount = action.amount ?? 400
      window.scrollBy({ top: action.direction === "down" ? amount : -amount, behavior: "smooth" })
      await delay(500)
      return { scrolled: action.direction }
    }

    case "extract": {
      if (action.selector) {
        const els = Array.from(document.querySelectorAll(action.selector))
        return els.map((e) => (e as HTMLElement).innerText?.trim()).filter(Boolean)
      }
      return document.body?.innerText?.slice(0, 10000)
    }

    case "screenshot": {
      // Can't do real screenshots from content script; return page state instead
      return getPageContext()
    }

    default:
      return { noop: true }
  }
}

function findByText(text: string): HTMLElement | null {
  const lower = text.toLowerCase()
  // Search buttons, links, then any visible element
  const candidates = [
    ...Array.from(document.querySelectorAll<HTMLElement>("button, a, [role=button]")),
    ...Array.from(document.querySelectorAll<HTMLElement>("li, span, div, h1, h2, h3, h4, h5, h6, p")),
  ]
  return candidates.find((el) => el.innerText?.trim().toLowerCase().includes(lower)) ?? null
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
