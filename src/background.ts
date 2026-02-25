/**
 * Background service worker
 *
 * - Opens side panel on extension icon click
 * - Relays EXECUTE_ACTION and GET_PAGE_CONTEXT messages to the active tab's
 *   content script
 * - Handles tab navigation requests
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Forward action execution to active tab's content script
  if (message?.type === "EXECUTE_ACTION") {
    void (async () => {
      try {
        const action = message.action
        // Handle navigate in background (content script can't reliably do cross-origin)
        if (action?.type === "navigate") {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab?.id) throw new Error("No active tab")
          await chrome.tabs.update(tab.id, { url: action.url })
          // Wait for page to load
          await new Promise<void>((resolve) => {
            const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
              if (tabId === tab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
              }
            }
            chrome.tabs.onUpdated.addListener(listener)
            // Timeout after 15s
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener)
              resolve()
            }, 15000)
          })
          sendResponse({ ok: true, result: { navigated: action.url } })
          return
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) throw new Error("No active tab")
        const result = await chrome.tabs.sendMessage(tab.id, message)
        sendResponse(result)
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }

  // Get page context from active tab
  if (message?.type === "GET_PAGE_CONTEXT") {
    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) throw new Error("No active tab")
        const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" })
        sendResponse(result)
      } catch (err) {
        sendResponse({ ok: false, error: String(err) })
      }
    })()
    return true
  }
})
