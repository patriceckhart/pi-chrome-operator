/**
 * React hook that manages the WebSocket connection to the Pi RPC bridge.
 *
 * Provides:
 *  - send(cmd)         – send any Pi RPC command (fire-and-forget)
 *  - sendCommand(cmd)  – send an RPC command and wait for its response
 *  - prompt(text)      – shorthand for sending a prompt
 *  - abort()           – abort current operation
 *  - newSession()      – start fresh
 *  - connected         – connection state
 *  - streaming         – whether Pi is currently responding
 *
 * Also handles BROWSER_ACTION_REQUEST messages from the bridge:
 * executes browser actions via the Chrome extension APIs and sends
 * BROWSER_ACTION_RESULT back.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ImageAttachment } from "@/types"

type PiEvent = Record<string, unknown> & { type: string }
type EventListener = (event: PiEvent) => void

/**
 * Execute a browser action via the Chrome extension's background service worker.
 * Handles all action types including tab management.
 */
async function executeBrowserAction(action: Record<string, unknown>): Promise<{
  ok: boolean
  result?: unknown
  error?: string
  context?: unknown
}> {
  const type = action.type as string

  // Tab management actions → dedicated background message types
  if (type === "list_tabs") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "LIST_TABS" }, (res) => {
        if (res?.ok && res.tabs) {
          resolve({ ok: true, result: { tabs: res.tabs } })
        } else {
          resolve(res ?? { ok: false, error: "No response" })
        }
      })
    })
  }

  if (type === "new_tab") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "NEW_TAB", url: action.url }, (res) => {
        resolve(res ?? { ok: false, error: "No response" })
      })
    })
  }

  if (type === "close_tab") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CLOSE_TAB", tabId: action.tabId }, (res) => {
        resolve(res ?? { ok: false, error: "No response" })
      })
    })
  }

  if (type === "switch_tab") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "SWITCH_TAB", tabId: action.tabId }, (res) => {
        resolve(res ?? { ok: false, error: "No response" })
      })
    })
  }

  if (type === "get_tab_context") {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT", tabId: action.tabId }, (res) => {
        if (res?.ok && res.context) {
          resolve({ ok: true, context: res.context })
        } else {
          resolve(res ?? { ok: false, error: "No response" })
        }
      })
    })
  }

  // All other actions → EXECUTE_ACTION with the full action object
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "EXECUTE_ACTION", action },
      (res) => resolve(res ?? { ok: false, error: "No response from content script" })
    )
  })
}

export function usePiBridge(bridgeUrl: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef<Set<EventListener>>(new Set())
  const [connected, setConnected] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Pending command responses (for sendCommand)
  const pendingCommandsRef = useRef<Map<string, {
    resolve: (data: PiEvent) => void
    timer: ReturnType<typeof setTimeout>
  }>>(new Map())
  const commandIdRef = useRef(0)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const ws = new WebSocket(bridgeUrl)

      ws.onopen = () => {
        console.log("[bridge] connected")
        setConnected(true)
      }

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as PiEvent

          // Handle browser action requests from the bridge
          if (data.type === "BROWSER_ACTION_REQUEST") {
            const requestId = data.requestId as string
            const action = data.action as Record<string, unknown>

            void executeBrowserAction(action).then((result) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "BROWSER_ACTION_RESULT",
                  requestId,
                  result,
                }))
              }
            })
            return
          }

          // Check for pending command responses
          if (data.type === "response" && data.id) {
            const pending = pendingCommandsRef.current.get(data.id as string)
            if (pending) {
              clearTimeout(pending.timer)
              pendingCommandsRef.current.delete(data.id as string)
              pending.resolve(data)
              // Don't return — still dispatch to listeners
            }
          }

          // Track streaming state
          if (data.type === "agent_start") setStreaming(true)
          if (data.type === "agent_end") setStreaming(false)

          // Dispatch to listeners
          listenersRef.current.forEach((fn) => fn(data))
        } catch {
          // ignore non-JSON
        }
      }

      ws.onclose = () => {
        console.log("[bridge] disconnected")
        setConnected(false)
        setStreaming(false)
        wsRef.current = null
        // Fail pending commands
        for (const [id, pending] of pendingCommandsRef.current) {
          clearTimeout(pending.timer)
          pending.resolve({ type: "response", success: false, error: "Disconnected" })
          pendingCommandsRef.current.delete(id)
        }
        // Reconnect after 3s
        reconnectTimerRef.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        ws.close()
      }

      wsRef.current = ws
    } catch {
      reconnectTimerRef.current = setTimeout(connect, 3000)
    }
  }, [bridgeUrl])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((cmd: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  /**
   * Send an RPC command and wait for its response.
   * Uses the `id` field for correlation.
   */
  const sendCommand = useCallback((cmd: Record<string, unknown>, timeoutMs = 10000): Promise<PiEvent> => {
    return new Promise((resolve) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        resolve({ type: "response", success: false, error: "Not connected" })
        return
      }

      const id = `cmd-${++commandIdRef.current}`
      const timer = setTimeout(() => {
        pendingCommandsRef.current.delete(id)
        resolve({ type: "response", success: false, error: "Timeout" })
      }, timeoutMs)

      pendingCommandsRef.current.set(id, { resolve, timer })
      wsRef.current!.send(JSON.stringify({ ...cmd, id }))
    })
  }, [])

  const prompt = useCallback(
    (message: string, opts?: { streamingBehavior?: "steer" | "followUp"; images?: ImageAttachment[] }) => {
      const { images, ...rest } = opts ?? {}
      const cmd: Record<string, unknown> = { type: "prompt", message, ...rest }
      if (images?.length) {
        cmd.images = images.map((img) => ({
          type: "image",
          data: img.data,
          mimeType: img.mimeType,
        }))
      }
      send(cmd)
    },
    [send]
  )

  const abort = useCallback(() => send({ type: "abort" }), [send])
  const newSession = useCallback(() => send({ type: "new_session" }), [send])
  const restart = useCallback(() => send({ type: "restart" }), [send])

  const onEvent = useCallback((fn: EventListener) => {
    listenersRef.current.add(fn)
    return () => {
      listenersRef.current.delete(fn)
    }
  }, [])

  return { send, sendCommand, prompt, abort, newSession, restart, connected, streaming, onEvent }
}
