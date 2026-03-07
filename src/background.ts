/**
 * Background service worker
 *
 * - Opens side panel on extension icon click
 * - Relays EXECUTE_ACTION and GET_PAGE_CONTEXT messages to content scripts
 * - Supports multi-tab operations via optional tabId field
 * - Handles tab management (list, create, close, switch)
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})

/**
 * Resolve which tab to operate on.
 * If tabId is provided, use that. Otherwise fall back to the active tab.
 */
async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId != null) {
    const tab = await chrome.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} not found`)
    return tab
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error("No active tab")
  return tab
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ── List all tabs ─────────────────────────────────────────────────────
  if (message?.type === "LIST_TABS") {
    void (async () => {
      try {
        const tabs = await chrome.tabs.query({})
        const result = tabs
          .filter((t) => t.id != null)
          .map((t) => ({
            tabId: t.id!,
            url: t.url ?? "",
            title: t.title ?? "",
            active: t.active ?? false,
            windowId: t.windowId,
          }))
        sendResponse({ ok: true, tabs: result })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // ── Create a new tab ──────────────────────────────────────────────────
  if (message?.type === "NEW_TAB") {
    void (async () => {
      try {
        const tab = await chrome.tabs.create({ url: message.url, active: true })
        // Wait for load
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
            if (tabId === tab.id && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener)
              resolve()
            }
          }
          chrome.tabs.onUpdated.addListener(listener)
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener)
            resolve()
          }, 15000)
        })
        sendResponse({ ok: true, result: { tabId: tab.id, url: tab.url, title: tab.title } })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // ── Close a tab ───────────────────────────────────────────────────────
  if (message?.type === "CLOSE_TAB") {
    void (async () => {
      try {
        await chrome.tabs.remove(message.tabId)
        sendResponse({ ok: true, result: { closed: message.tabId } })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // ── Switch to a tab ───────────────────────────────────────────────────
  if (message?.type === "SWITCH_TAB") {
    void (async () => {
      try {
        const tab = await chrome.tabs.update(message.tabId, { active: true })
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
        sendResponse({ ok: true, result: { switched: message.tabId } })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // ── Forward action execution to a tab's content script ────────────────
  if (message?.type === "EXECUTE_ACTION") {
    void (async () => {
      try {
        const action = message.action
        // Handle navigate in background (content script can't reliably do cross-origin)
        if (action?.type === "navigate") {
          const tab = await resolveTab(action.tabId)
          await chrome.tabs.update(tab.id!, { url: action.url })
          // Wait for page to load
          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
              }
            }
            chrome.tabs.onUpdated.addListener(listener)
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener)
              resolve()
            }, 15000)
          })
          sendResponse({ ok: true, result: { navigated: action.url, tabId: tab.id } })
          return
        }

        // Tab management actions handled directly
        if (action?.type === "list_tabs") {
          const tabs = await chrome.tabs.query({})
          const result = tabs
            .filter((t) => t.id != null)
            .map((t) => ({
              tabId: t.id!,
              url: t.url ?? "",
              title: t.title ?? "",
              active: t.active ?? false,
              windowId: t.windowId,
            }))
          sendResponse({ ok: true, result: { tabs: result } })
          return
        }

        if (action?.type === "new_tab") {
          const newTab = await chrome.tabs.create({ url: action.url, active: true })
          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (tabId === newTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
              }
            }
            chrome.tabs.onUpdated.addListener(listener)
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener)
              resolve()
            }, 15000)
          })
          sendResponse({ ok: true, result: { tabId: newTab.id, url: newTab.url, title: newTab.title } })
          return
        }

        if (action?.type === "close_tab") {
          await chrome.tabs.remove(action.tabId)
          sendResponse({ ok: true, result: { closed: action.tabId } })
          return
        }

        if (action?.type === "switch_tab") {
          const switched = await chrome.tabs.update(action.tabId, { active: true })
          if (switched.windowId) {
            await chrome.windows.update(switched.windowId, { focused: true })
          }
          sendResponse({ ok: true, result: { switched: action.tabId } })
          return
        }

        if (action?.type === "get_tab_context") {
          const tab = await resolveTab(action.tabId)
          if (!tab.id) throw new Error("No tab ID")
          const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" })
          sendResponse(result)
          return
        }

        // All other actions → forward to content script in the target tab
        const tab = await resolveTab(action?.tabId)
        if (!tab.id) throw new Error("No tab ID")
        const result = await chrome.tabs.sendMessage(tab.id, message)
        sendResponse(result)
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // Execute a function in the page's main world (bypasses CSP)
  if (message?.type === "EXECUTE_IN_PAGE_WORLD") {
    void (async () => {
      try {
        const tabId = message.tabId
        const tab = await resolveTab(tabId)
        if (!tab.id) throw new Error("No tab ID")
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: (fnStr: string, args: unknown) => {
            // eslint-disable-next-line no-eval
            const fn = eval("(" + fnStr + ")")
            return fn(args)
          },
          args: [message.fn, message.args],
        })
        const result = results?.[0]?.result
        sendResponse({ ok: true, result })
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // Get page context from a specific tab or active tab
  if (message?.type === "GET_PAGE_CONTEXT") {
    void (async () => {
      try {
        const tab = await resolveTab(message.tabId)
        if (!tab.id) throw new Error("No tab ID")
        const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" })
        sendResponse(result)
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }
})
