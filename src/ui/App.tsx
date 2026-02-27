import { useCallback, useEffect, useRef, useState } from "react"
import {
  Send,
  BookOpen,
  Settings,
  RotateCcw,
  Wifi,
  WifiOff,
  Eye,
  ImagePlus,
  X,
} from "lucide-react"
import { PiLogo } from "@/components/PiLogo"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatMessage } from "./ChatMessage"
import { RoutinePanel } from "./RoutinePanel"
import { SettingsPanel } from "./SettingsPanel"
import { usePiBridge } from "@/hooks/usePiBridge"
import { useRoutines } from "@/hooks/useRoutines"
import { useSettings } from "@/hooks/useSettings"
import type { ChatMessage as ChatMessageType, BrowserAction, ImageAttachment } from "@/types"

type View = "chat" | "routines" | "settings"

export function App() {
  const { settings, updateSettings } = useSettings()
  const { connected, streaming, prompt: sendPrompt, abort, newSession, onEvent } = usePiBridge(settings.bridgeUrl)
  const { routines, saveRoutine, deleteRoutine } = useRoutines()

  const [view, setView] = useState<View>("chat")
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [input, setInput] = useState("")
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const [runningActions, setRunningActions] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentAssistantRef = useRef<string | null>(null)
  const abortActionsRef = useRef<AbortController | null>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const addMessage = useCallback((msg: Omit<ChatMessageType, "id" | "timestamp">) => {
    const full: ChatMessageType = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, full])
    return full.id
  }, [])

  const updateMessage = useCallback((id: string, update: Partial<ChatMessageType>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...update } : m))
    )
  }, [])

  // ── Image handling ───────────────────────────────────────────────────────

  const fileToAttachment = useCallback((file: File): Promise<ImageAttachment> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        // dataUrl = "data:image/png;base64,AAAA..."
        const [header, base64] = dataUrl.split(",")
        const mimeType = header.match(/data:(.*?);/)?.[1] ?? "image/png"
        resolve({
          id: crypto.randomUUID(),
          data: base64,
          mimeType,
          name: file.name,
          preview: dataUrl,
        })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }, [])

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"))
    if (imageFiles.length === 0) return
    const attachments = await Promise.all(imageFiles.map(fileToAttachment))
    setPendingImages((prev) => [...prev, ...attachments])
  }, [fileToAttachment])

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  // Handle paste (images from clipboard)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return

    e.preventDefault()
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[]
    addImages(files)
  }, [addImages])

  // Handle file input change
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    addImages(files)
    // Reset input so the same file can be selected again
    e.target.value = ""
  }, [addImages])

  // Handle drag & drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    addImages(files)
  }, [addImages])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // Get page context and include it in the prompt
  const getPageContext = useCallback(async (): Promise<string> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" }, (res) => {
        if (res?.ok && res.context) {
          const ctx = res.context
          let contextStr = `\n\n[Current browser tab]\nURL: ${ctx.url}\nTitle: ${ctx.title}\n`
          if (ctx.inputs?.length) {
            contextStr += `\nForm inputs:\n${ctx.inputs.map((i: { selector: string; type: string; name: string; placeholder: string }) => `  - ${i.selector} (${i.type}) name="${i.name}" placeholder="${i.placeholder}"`).join("\n")}\n`
          }
          if (ctx.buttons?.length) {
            contextStr += `\nButtons:\n${ctx.buttons.map((b: { selector: string; text: string }) => `  - ${b.selector}: "${b.text}"`).join("\n")}\n`
          }
          if (ctx.links?.length) {
            contextStr += `\nLinks:\n${ctx.links.slice(0, 20).map((l: { text: string; href: string }) => `  - "${l.text}" → ${l.href}`).join("\n")}\n`
          }
          if (ctx.text) {
            contextStr += `\nPage text (excerpt):\n${ctx.text.slice(0, 3000)}\n`
          }
          resolve(contextStr)
        } else {
          resolve("")
        }
      })
    })
  }, [])

  // Send a chat message
  const handleSend = useCallback(
    async (text?: string) => {
      const msg = text ?? input.trim()
      const images = [...pendingImages]
      if (!msg && images.length === 0) return
      setInput("")
      setPendingImages([])

      // Add user message (with image previews)
      addMessage({
        role: "user",
        content: msg,
        images: images.length > 0 ? images : undefined,
      })

      // Get page context
      const pageCtx = await getPageContext()

      // Build the full prompt with context and browser instructions
      const systemPreamble = `You are Pi, an AI assistant embedded in a Chrome browser extension. You can chat normally AND control the browser.

When the user wants you to interact with a web page, respond with browser actions in this exact format:

\`\`\`browser-action
{"type":"click","selector":"#some-button"}
\`\`\`

Available actions:
- {"type":"navigate","url":"https://..."} - go to a URL
- {"type":"click","selector":"...","text":"visible text"} - click an element
- {"type":"type","selector":"...","text":"...","submit":true/false} - type into a field
- {"type":"select","selector":"...","value":"..."} - select dropdown option
- {"type":"wait","ms":1000} - wait
- {"type":"scroll","direction":"down","amount":400} - scroll
- {"type":"extract","selector":"..."} - extract text content

You can include multiple browser-action blocks in one response. Between actions, explain what you're doing.

If you just need to chat, answer normally without any browser-action blocks.

IMPORTANT: Always look at the page context to understand what's currently on screen before deciding actions.`

      const fullPrompt = `${systemPreamble}\n${pageCtx}\n\nUser: ${msg || "(see attached image)"}`

      sendPrompt(fullPrompt, images.length > 0 ? { images } : undefined)
    },
    [input, pendingImages, addMessage, getPageContext, sendPrompt]
  )

  // Handle Pi events
  useEffect(() => {
    return onEvent((event) => {
      switch (event.type) {
        case "agent_start": {
          const id = addMessage({ role: "assistant", content: "", streaming: true })
          currentAssistantRef.current = id
          break
        }

        case "message_update": {
          const evt = event.assistantMessageEvent as { type: string; delta?: string }
          if (evt?.type === "text_delta" && evt.delta && currentAssistantRef.current) {
            const delta = evt.delta
            const targetId = currentAssistantRef.current
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId
                  ? { ...m, content: (m.content || "") + delta, streaming: true }
                  : m
              )
            )
          }
          break
        }

        case "agent_end": {
          if (currentAssistantRef.current) {
            const finishedId = currentAssistantRef.current
            currentAssistantRef.current = null

            // Mark streaming as done, then extract content and run actions
            setMessages((prev) => {
              const msg = prev.find((m) => m.id === finishedId)
              if (msg?.content) {
                // Schedule action execution outside the state updater
                setTimeout(() => parseBrowserActions(msg.content), 100)
              }
              return prev.map((m) =>
                m.id === finishedId ? { ...m, streaming: false } : m
              )
            })
          }
          break
        }

        case "tool_execution_start": {
          const name = event.toolName as string
          const args = event.args as Record<string, unknown>
          addMessage({
            role: "tool",
            content: `Tool: ${name}: ${JSON.stringify(args).slice(0, 200)}`,
          })
          break
        }

        case "tool_execution_end": {
          const result = event.result as { content?: Array<{ text?: string }> }
          const text = result?.content?.[0]?.text
          if (text) {
            addMessage({
              role: "tool",
              content: `Done: ${text.slice(0, 300)}${text.length > 300 ? "…" : ""}`,
            })
          }
          break
        }

        case "response": {
          const resp = event as { success?: boolean; error?: string; command?: string }
          if (!resp.success && resp.error) {
            addMessage({
              role: "status",
              content: `Error: ${resp.error}`,
            })
          }
          break
        }
      }
    })
  }, [onEvent, addMessage, updateMessage])

  // Parse and execute browser actions from Pi's response, then feed results back
  const parseBrowserActions = useCallback(
    async (content: string) => {
      // Match ```browser-action blocks (handle optional whitespace / newlines)
      const actionRegex = /```browser-action\s*\n?([\s\S]*?)```/g
      let match
      const actions: BrowserAction[] = []

      while ((match = actionRegex.exec(content)) !== null) {
        try {
          const action = JSON.parse(match[1].trim()) as BrowserAction
          actions.push(action)
        } catch {
          // invalid JSON, skip
        }
      }

      if (actions.length === 0) return

      // Set up abort controller for this action run
      const ac = new AbortController()
      abortActionsRef.current = ac
      setRunningActions(true)

      const results: string[] = []

      for (const action of actions) {
        // Check if aborted before each action
        if (ac.signal.aborted) {
          addMessage({ role: "status", content: "Stopped by user" })
          break
        }

        const label =
          action.type === "navigate"
            ? `navigate → ${action.url}`
            : action.type === "click"
            ? `click → ${(action as { selector?: string }).selector || (action as { text?: string }).text || "?"}`
            : action.type === "type"
            ? `type into ${(action as { selector: string }).selector}`
            : action.type === "extract"
            ? `extract from ${(action as { selector?: string }).selector || "page"}`
            : action.type

        addMessage({ role: "status", content: `Running: ${label}` })

        try {
          const result = await new Promise<{ ok: boolean; result?: unknown; error?: string }>((resolve) => {
            chrome.runtime.sendMessage(
              { type: "EXECUTE_ACTION", action },
              (res) => resolve(res ?? { ok: false, error: "No response from content script" })
            )
          })

          if (ac.signal.aborted) {
            addMessage({ role: "status", content: "Stopped by user" })
            break
          }

          if (result.ok) {
            addMessage({ role: "status", content: `Done: ${label}` })
            results.push(`Action ${action.type}: success${result.result ? " → " + JSON.stringify(result.result).slice(0, 500) : ""}`)
          } else {
            addMessage({ role: "status", content: `Failed: ${label}: ${result.error}` })
            results.push(`Action ${action.type}: FAILED — ${result.error}`)
          }

          // Delay between actions to let page update
          await new Promise((r) => setTimeout(r, 800))
        } catch (err) {
          addMessage({ role: "status", content: `Failed: ${label}: ${err}` })
          results.push(`Action ${action.type}: ERROR — ${err}`)
        }
      }

      abortActionsRef.current = null
      setRunningActions(false)

      // After all actions, get fresh page context and feed results back to Pi
      // (but not if we were aborted)
      if (results.length > 0 && !ac.signal.aborted) {
        const pageCtx = await getPageContext()
        const feedback = `[Browser action results]\n${results.join("\n")}\n${pageCtx}\n\nPlease continue based on the results above. If the actions were successful, tell me what happened. If something failed, suggest what to try instead.`
        sendPrompt(feedback, { streamingBehavior: "followUp" })
      }
    },
    [addMessage, getPageContext, sendPrompt]
  )

  // Stop everything — Pi streaming + browser actions
  const handleStop = useCallback(() => {
    // Abort Pi RPC
    abort()
    // Abort running browser actions
    if (abortActionsRef.current) {
      abortActionsRef.current.abort()
    }
    // Reset streaming assistant message
    if (currentAssistantRef.current) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentAssistantRef.current ? { ...m, streaming: false } : m
        )
      )
      currentAssistantRef.current = null
    }
    setRunningActions(false)
    addMessage({ role: "status", content: "Stopped" })
  }, [abort, addMessage])

  // Grab page context
  const inspectPage = useCallback(async () => {
    const ctx = await getPageContext()
    if (ctx) {
      addMessage({ role: "status", content: `Page context: Page context captured (${ctx.length} chars)` })
    }
  }, [getPageContext, addMessage])

  // ── Render ──────────────────────────────────────────────────────────────

  if (view === "routines") {
    return (
      <RoutinePanel
        routines={routines}
        onRun={(prompt) => {
          setView("chat")
          handleSend(prompt)
        }}
        onSave={saveRoutine}
        onDelete={deleteRoutine}
        onBack={() => setView("chat")}
      />
    )
  }

  if (view === "settings") {
    return (
      <SettingsPanel
        settings={settings}
        onChange={updateSettings}
        onBack={() => setView("chat")}
      />
    )
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <PiLogo className="h-4 w-4 text-white" />
          <span className="font-semibold text-sm">Pi Operator</span>
          <Badge variant={connected ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
            {connected ? (
              <>
                <Wifi className="h-2.5 w-2.5 mr-0.5" /> live
              </>
            ) : (
              <>
                <WifiOff className="h-2.5 w-2.5 mr-0.5" /> offline
              </>
            )}
          </Badge>
        </div>
        <div className="flex gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={inspectPage} title="Inspect page">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setView("routines")} title="Routines">
            <BookOpen className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setView("settings")} title="Settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => {
              newSession()
              setMessages([])
            }}
            title="New session"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 py-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12 text-muted-foreground">
            <PiLogo className="h-10 w-10 mb-3 text-white" />
            <div className="text-sm font-medium mb-1">Hi! I'm Pi.</div>
            <div className="text-xs">
              Ask me anything, or tell me to interact with the page.
              <br />
              Try: "Summarize this page" or "Check my Gmail"
            </div>
            {!connected && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                Bridge not connected. Run:<br />
                <code className="font-mono">npx tsx server/bridge.ts</code>
              </div>
            )}
          </div>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
      </ScrollArea>

      {/* Input */}
      <div
        className="border-t px-2 py-2 bg-background"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Image preview strip */}
        {pendingImages.length > 0 && (
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {pendingImages.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.preview}
                  alt={img.name ?? "upload"}
                  className="h-14 w-14 rounded-lg object-cover border border-border"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Image upload button */}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected}
            className="shrink-0 h-[38px] w-[38px]"
            title="Upload image"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            onPaste={handlePaste}
            placeholder={connected ? "Ask Pi anything… paste or drop images" : "Start bridge first..."}
            disabled={!connected}
            rows={1}
            className="min-h-[38px] max-h-[120px] resize-none text-sm"
          />
          {streaming || runningActions ? (
            <Button size="icon" variant="ghost" onClick={handleStop} className="shrink-0 h-[38px] w-[38px]">
              <span className="block h-4 w-4 rounded-full bg-red-500" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={!connected || (!input.trim() && pendingImages.length === 0)}
              className="shrink-0 h-[38px] w-[38px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
