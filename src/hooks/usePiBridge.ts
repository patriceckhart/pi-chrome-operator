/**
 * React hook that manages the WebSocket connection to the Pi RPC bridge.
 *
 * Provides:
 *  - send(cmd)         – send any Pi RPC command
 *  - prompt(text)      – shorthand for sending a prompt
 *  - abort()           – abort current operation
 *  - newSession()      – start fresh
 *  - connected         – connection state
 *  - streaming         – whether Pi is currently responding
 *
 * Events from Pi are dispatched to subscribers via onEvent().
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ImageAttachment } from "@/types"

type PiEvent = Record<string, unknown> & { type: string }
type EventListener = (event: PiEvent) => void

export function usePiBridge(bridgeUrl: string) {
  const wsRef = useRef<WebSocket | null>(null)
  const listenersRef = useRef<Set<EventListener>>(new Set())
  const [connected, setConnected] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()

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

  return { send, prompt, abort, newSession, restart, connected, streaming, onEvent }
}
