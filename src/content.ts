/**
 * Content script - runs on every page.
 *
 * Handles two things:
 *   1. EXECUTE_ACTION  - perform a browser action (click, type, etc.)
 *   2. GET_PAGE_CONTEXT - return structured info about the current page
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

// ── Main world script execution ─────────────────────────────────────────────
//
// Content scripts run in an isolated world and CANNOT access page JS variables
// like window.monaco, window.CKEDITOR, etc. We use chrome.scripting.executeScript
// with world: "MAIN" via the background service worker, which bypasses CSP.

/**
 * Run a function in the page's main world via the background service worker.
 * Uses chrome.scripting.executeScript with world: "MAIN" to bypass CSP.
 */
function runInPageWorld<T>(fn: string, args: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "EXECUTE_IN_PAGE_WORLD", fn, args },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (response?.ok) {
          resolve(response.result as T)
        } else {
          reject(new Error(response?.error || "Page world execution failed"))
        }
      }
    )
  })
}

/**
 * Try to set Monaco editor value via the page's main world.
 * Returns true if a Monaco editor was found and set.
 *
 * Critical: We must use the editor INSTANCE's setValue(), not the model's
 * setValue() directly, and we must not corrupt the editor DOM. The approach:
 *  1. Find editor instances via getEditors() or require()
 *  2. Use editor.getModel().pushEditOperations() for clean content replacement
 *  3. Fall back to editor.setValue() which handles re-rendering properly
 */
async function tryMonacoAPI(selector: string, text: string): Promise<boolean> {
  try {
    return await runInPageWorld<boolean>(`
      function(args) {
        var selector = args.selector;
        var text = args.text;

        // Helper: safely set value on a Monaco editor instance
        function safeSetValue(editor) {
          if (!editor) return false;
          try {
            var model = editor.getModel ? editor.getModel() : null;
            if (model) {
              // Use pushEditOperations for a clean edit that preserves the editor
              var fullRange = model.getFullModelRange();
              model.pushEditOperations(
                [],
                [{
                  range: fullRange,
                  text: text
                }],
                function() { return null; }
              );
              return true;
            }
            // Fallback to setValue on the editor instance itself
            if (editor.setValue) {
              editor.setValue(text);
              return true;
            }
          } catch(e) {}
          return false;
        }

        // Helper: find editor instance that contains the target element
        function findEditorForElement(editors, target) {
          if (!editors || !target) return null;
          for (var i = 0; i < editors.length; i++) {
            var container = null;
            try { container = editors[i].getContainerDomNode(); } catch(e) {}
            if (!container) {
              try { container = editors[i].getDomNode(); } catch(e) {}
            }
            if (container && (container === target || container.contains(target) || target.contains(container))) {
              return editors[i];
            }
            // Also check parent chain - selector might point to a child of the editor
            var parent = target.parentElement;
            while (parent) {
              if (parent === container) return editors[i];
              parent = parent.parentElement;
            }
          }
          return null;
        }

        var target = document.querySelector(selector);
        // Also try to find the .monaco-editor container if selector doesn't point to it
        var monacoEl = target ? (target.closest(".monaco-editor") || target.querySelector(".monaco-editor")) : null;
        if (!monacoEl) monacoEl = document.querySelector(".monaco-editor");

        // Method 1: window.monaco.editor.getEditors() (Monaco >= 0.21)
        if (window.monaco && window.monaco.editor && window.monaco.editor.getEditors) {
          var editors = window.monaco.editor.getEditors();
          if (editors && editors.length > 0) {
            var matched = findEditorForElement(editors, target || monacoEl);
            if (matched) return safeSetValue(matched);
            if (editors.length === 1) return safeSetValue(editors[0]);
          }
        }

        // Method 2: AMD require - many Monaco deployments use this
        if (typeof require === "function") {
          var modules = [
            "vs/editor/editor.main",
            "vs/editor/editor.api",
            "monaco-editor"
          ];
          for (var m = 0; m < modules.length; m++) {
            try {
              var mod = require(modules[m]);
              if (mod && mod.editor && mod.editor.getEditors) {
                var eds = mod.editor.getEditors();
                if (eds && eds.length > 0) {
                  var matched2 = findEditorForElement(eds, target || monacoEl);
                  if (matched2) return safeSetValue(matched2);
                  if (eds.length === 1) return safeSetValue(eds[0]);
                }
              }
            } catch(e) {}
          }
        }

        // Method 3: look for editor instances attached to DOM nodes
        var monacoEls = document.querySelectorAll(".monaco-editor");
        for (var j = 0; j < monacoEls.length; j++) {
          var el = monacoEls[j];
          var instance = el.__monacoEditor || el._editor || el.editor;
          if (instance && (instance.getModel || instance.setValue)) {
            return safeSetValue(instance);
          }
        }

        // Method 4: last resort - find model via getModels and use pushEditOperations
        if (window.monaco && window.monaco.editor && window.monaco.editor.getModels) {
          var models = window.monaco.editor.getModels();
          if (models && models.length > 0) {
            try {
              var model = models[0];
              var fullRange = model.getFullModelRange();
              model.pushEditOperations(
                [],
                [{ range: fullRange, text: text }],
                function() { return null; }
              );
              return true;
            } catch(e) {
              // Very last resort: direct setValue on model
              try {
                models[0].setValue(text);
                return true;
              } catch(e2) {}
            }
          }
        }

        return false;
      }
    `, { selector, text })
  } catch {
    return false
  }
}

/**
 * Try to set CKEditor value via the page's main world.
 */
async function tryCKEditorAPI(selector: string, text: string): Promise<boolean> {
  try {
    return await runInPageWorld<boolean>(`
      function(args) {
        var selector = args.selector;
        var text = args.text;

        // CKEditor 5: instance on DOM element
        var editable = document.querySelector(".ck-editor__editable");
        if (editable && editable.ckeditorInstance) {
          editable.ckeditorInstance.setData(text);
          return true;
        }

        // CKEditor 4: global CKEDITOR
        if (window.CKEDITOR && window.CKEDITOR.instances) {
          var keys = Object.keys(window.CKEDITOR.instances);
          if (keys.length > 0) {
            window.CKEDITOR.instances[keys[0]].setData(text);
            return true;
          }
        }

        return false;
      }
    `, { selector, text })
  } catch {
    return false
  }
}

/**
 * Try to set TinyMCE value via the page's main world.
 */
async function tryTinyMCEAPI(text: string): Promise<boolean> {
  try {
    return await runInPageWorld<boolean>(`
      function(args) {
        if (window.tinymce && window.tinymce.activeEditor) {
          window.tinymce.activeEditor.setContent(args.text);
          return true;
        }
        return false;
      }
    `, { text })
  } catch {
    return false
  }
}

// ── Page context ────────────────────────────────────────────────────────────

function getPageContext(): PageContext {
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

  // Detect contenteditable elements (CKEditor, Monaco visible areas, etc.)
  const editables = Array.from(document.querySelectorAll<HTMLElement>(
    "[contenteditable=true], [contenteditable=''], .monaco-editor, .ck-editor__editable, .ProseMirror, .tox-edit-area__iframe"
  )).slice(0, 20).map((el, i) => {
    const selector = uniqueSelector(el, i, "editable")
    return {
      selector,
      type: "contenteditable",
      name: el.getAttribute("aria-label") || el.getAttribute("role") || "",
      placeholder: el.getAttribute("data-placeholder") || "",
      value: el.innerText?.slice(0, 200) || "",
    }
  })

  const allInputs = [...inputs, ...editables]

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

  const textContent = document.body?.innerText?.slice(0, 8000) || ""

  return {
    url: location.href,
    title: document.title,
    text: textContent,
    links,
    inputs: allInputs,
    buttons,
  }
}

function uniqueSelector(el: Element, _index: number, _prefix: string): string {
  if (el.id) return `#${CSS.escape(el.id)}`
  const testId = el.getAttribute("data-testid")
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`
  const name = el.getAttribute("name")
  if (name) {
    const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
    if (document.querySelectorAll(sel).length === 1) return sel
  }
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) {
    const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`
    if (document.querySelectorAll(sel).length === 1) return sel
  }
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

// ── Rich editor detection ───────────────────────────────────────────────────

function detectEditor(el: Element): {
  type: "native" | "monaco" | "ckeditor" | "contenteditable" | "prosemirror" | "tinymce"
  target: HTMLElement
} {
  // Monaco Editor
  const monacoContainer = el.closest(".monaco-editor") ?? document.querySelector(".monaco-editor")
  if (monacoContainer || el.classList.contains("monaco-editor")) {
    const container = monacoContainer ?? el
    const textarea = container.querySelector("textarea.inputarea") as HTMLElement | null
    if (textarea) return { type: "monaco", target: textarea }
    // Fallback: the container itself
    return { type: "monaco", target: container as HTMLElement }
  }

  // CKEditor 5
  const ckEditable = el.closest(".ck-editor__editable") ?? el.querySelector(".ck-editor__editable")
  if (ckEditable) return { type: "ckeditor", target: ckEditable as HTMLElement }

  // CKEditor 4
  const cke4 = el.closest("[id^=cke_]")
  if (cke4) {
    const iframe = cke4.querySelector("iframe") as HTMLIFrameElement | null
    if (iframe?.contentDocument?.body) {
      return { type: "ckeditor", target: iframe.contentDocument.body }
    }
  }

  // ProseMirror (Tiptap, Remirror, etc.)
  const prosemirror = el.closest(".ProseMirror")
  if (prosemirror) return { type: "prosemirror", target: prosemirror as HTMLElement }

  // TinyMCE
  const tinymce = el.closest(".tox-edit-area")
  if (tinymce) {
    const iframe = tinymce.querySelector("iframe") as HTMLIFrameElement | null
    if (iframe?.contentDocument?.body) {
      return { type: "tinymce", target: iframe.contentDocument.body }
    }
  }

  // Generic contenteditable
  if ((el as HTMLElement).isContentEditable || el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "") {
    return { type: "contenteditable", target: el as HTMLElement }
  }

  // Walk up to find contenteditable parent
  let parent = el.parentElement
  while (parent && parent !== document.body) {
    if (parent.isContentEditable) {
      return { type: "contenteditable", target: parent }
    }
    parent = parent.parentElement
  }

  return { type: "native", target: el as HTMLElement }
}

// ── Text insertion (keyboard-level fallback) ────────────────────────────────

async function insertText(target: HTMLElement, text: string, charByChar: boolean): Promise<void> {
  target.focus()
  await delay(100)

  // Select all existing content to replace it
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select()
  } else {
    const sel = window.getSelection()
    if (sel && target.childNodes.length > 0) {
      const range = document.createRange()
      range.selectNodeContents(target)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
  await delay(50)

  // Delete selected content
  document.execCommand("delete", false)
  await delay(50)

  if (charByChar) {
    for (const char of text) {
      const beforeInput = new InputEvent("beforeinput", {
        inputType: "insertText",
        data: char,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
      const cancelled = !target.dispatchEvent(beforeInput)

      if (!cancelled) {
        if (!document.execCommand("insertText", false, char)) {
          const inputEvent = new InputEvent("input", {
            inputType: "insertText",
            data: char,
            bubbles: true,
            composed: true,
          })
          target.dispatchEvent(inputEvent)
        }
      }

      await delay(15 + Math.random() * 25)
    }
  } else {
    const beforeInput = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: text,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
    target.dispatchEvent(beforeInput)

    if (!document.execCommand("insertText", false, text)) {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = text
        target.dispatchEvent(new Event("input", { bubbles: true }))
        target.dispatchEvent(new Event("change", { bubbles: true }))
      } else {
        target.textContent = text
        target.dispatchEvent(new InputEvent("input", {
          inputType: "insertText",
          data: text,
          bubbles: true,
          composed: true,
        }))
      }
    }
  }
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
      const el = document.querySelector(action.selector) as HTMLElement | null
      if (!el) throw new Error(`Input not found: ${action.selector}`)

      el.scrollIntoView({ behavior: "smooth", block: "center" })
      await delay(200)

      const editor = detectEditor(el)

      // Try editor JS APIs via main world injection (most reliable)
      if (editor.type === "monaco") {
        const ok = await tryMonacoAPI(action.selector, action.text)
        if (ok) {
          if (action.submit) await submitForm(el, editor.target)
          return { typed: action.selector, text: action.text, method: "api", editor: "monaco" }
        }
      }

      if (editor.type === "ckeditor") {
        const ok = await tryCKEditorAPI(action.selector, action.text)
        if (ok) {
          if (action.submit) await submitForm(el, editor.target)
          return { typed: action.selector, text: action.text, method: "api", editor: "ckeditor" }
        }
      }

      if (editor.type === "tinymce") {
        const ok = await tryTinyMCEAPI(action.text)
        if (ok) {
          if (action.submit) await submitForm(el, editor.target)
          return { typed: action.selector, text: action.text, method: "api", editor: "tinymce" }
        }
      }

      // Keyboard-level simulation fallback
      const useCharByChar = action.text.length < 500
      await insertText(editor.target, action.text, useCharByChar)

      if (action.submit) await submitForm(el, editor.target)

      return { typed: action.selector, text: action.text, method: "keyboard", editor: editor.type }
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
      return getPageContext()
    }

    default:
      return { noop: true }
  }
}

async function submitForm(el: HTMLElement, target: HTMLElement) {
  await delay(200)
  const form = el.closest("form")
  if (form) {
    form.requestSubmit()
  } else {
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, composed: true,
    }))
    target.dispatchEvent(new KeyboardEvent("keypress", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, composed: true,
    }))
    target.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true, composed: true,
    }))
  }
}

function findByText(text: string): HTMLElement | null {
  const lower = text.toLowerCase()
  const candidates = [
    ...Array.from(document.querySelectorAll<HTMLElement>("button, a, [role=button]")),
    ...Array.from(document.querySelectorAll<HTMLElement>("li, span, div, h1, h2, h3, h4, h5, h6, p")),
  ]
  return candidates.find((el) => el.innerText?.trim().toLowerCase().includes(lower)) ?? null
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
