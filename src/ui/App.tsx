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
  ChevronDown,
  Sparkles,
} from "lucide-react"
import { PiLogo } from "@/components/PiLogo"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatMessage, ActivityBlock } from "./ChatMessage"
import type { ActivityGroup, ActivityItem } from "./ChatMessage"
import { RoutinePanel } from "./RoutinePanel"
import { SettingsPanel } from "./SettingsPanel"
import { usePiBridge } from "@/hooks/usePiBridge"
import { useRoutines } from "@/hooks/useRoutines"
import { useSettings } from "@/hooks/useSettings"
import type { ChatMessage as ChatMessageType, ImageAttachment } from "@/types"

type View = "chat" | "routines" | "settings"

type PiModel = {
  id: string
  name: string
  provider: string
  reasoning?: boolean
}

export function App() {
  const { settings, updateSettings } = useSettings()
  const { connected, streaming, prompt: sendPrompt, abort, newSession, send, sendCommand, onEvent } = usePiBridge(settings.bridgeUrl)
  const { routines, saveRoutine, deleteRoutine } = useRoutines()

  const [view, setView] = useState<View>("chat")
  const [messages, setMessages] = useState<ChatMessageType[]>([])
  const [input, setInput] = useState("")
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentAssistantRef = useRef<string | null>(null)

  // Activity groups (tool calls + results)
  const [activityGroups, setActivityGroups] = useState<ActivityGroup[]>([])
  const currentGroupRef = useRef<string | null>(null)

  // Model state
  const [models, setModels] = useState<PiModel[]>([])
  const [currentModel, setCurrentModel] = useState<PiModel | null>(null)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    if (modelDropdownOpen) {
      document.addEventListener("mousedown", handleClick)
      return () => document.removeEventListener("mousedown", handleClick)
    }
  }, [modelDropdownOpen])

  // Fetch models and current state when connected
  useEffect(() => {
    if (!connected) {
      setModels([])
      setCurrentModel(null)
      return
    }

    // Get available models
    void sendCommand({ type: "get_available_models" }).then((res) => {
      if (res.success && res.data) {
        const data = res.data as { models: PiModel[] }
        if (data.models) {
          setModels(data.models)
        }
      }
    })

    // Get current state (including active model)
    void sendCommand({ type: "get_state" }).then((res) => {
      if (res.success && res.data) {
        const data = res.data as { model?: PiModel }
        if (data.model) {
          setCurrentModel(data.model)
        }
      }
    })
  }, [connected, sendCommand])

  // Switch model
  const handleModelSelect = useCallback(async (model: PiModel) => {
    setModelDropdownOpen(false)
    const res = await sendCommand({ type: "set_model", provider: model.provider, modelId: model.id })
    if (res.success) {
      setCurrentModel(model)
    }
  }, [sendCommand])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, activityGroups])

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

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith("image/"))
    if (imageItems.length === 0) return
    e.preventDefault()
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean) as File[]
    addImages(files)
  }, [addImages])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    addImages(files)
    e.target.value = ""
  }, [addImages])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    addImages(files)
  }, [addImages])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // ── Send a chat message ──────────────────────────────────────────────────

  const handleSend = useCallback(
    async (text?: string) => {
      const msg = text ?? input.trim()
      const images = [...pendingImages]
      if (!msg && images.length === 0) return
      setInput("")
      setPendingImages([])

      // Collapse all previous activity groups
      setActivityGroups((prev) =>
        prev.map((g) => ({ ...g, collapsed: true }))
      )
      currentGroupRef.current = null

      addMessage({
        role: "user",
        content: msg,
        images: images.length > 0 ? images : undefined,
      })

      sendPrompt(
        msg || "(see attached image)",
        images.length > 0 ? { images } : undefined
      )
    },
    [input, pendingImages, addMessage, sendPrompt]
  )

  // ── Handle Pi events ─────────────────────────────────────────────────────

  useEffect(() => {
    return onEvent((event) => {
      switch (event.type) {
        case "agent_start": {
          // If there was a tool group before this text, close it
          currentGroupRef.current = null
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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === finishedId ? { ...m, streaming: false } : m
              )
            )
          }
          break
        }

        case "tool_execution_start": {
          const name = event.toolName as string
          const args = event.args as Record<string, unknown>
          let label = name
          if (name === "browser_action") {
            const action = args.action as string
            const tabId = args.tabId as number | undefined
            label = `${action}${tabId ? ` (tab ${tabId})` : ""}`
            if (args.selector) label += ` → ${args.selector}`
            if (args.url) label += ` → ${args.url}`
          }

          const itemId = crypto.randomUUID()
          const item: ActivityItem = {
            id: itemId,
            label,
            timestamp: Date.now(),
          }

          setActivityGroups((prev) => {
            // Find or create current group
            let groupId = currentGroupRef.current
            if (groupId) {
              // Add to existing group
              return prev.map((g) =>
                g.id === groupId ? { ...g, items: [...g.items, item] } : g
              )
            } else {
              // Create new group
              groupId = crypto.randomUUID()
              currentGroupRef.current = groupId
              return [...prev, { id: groupId, items: [item], collapsed: false }]
            }
          })

          // Store item id for matching with tool_execution_end
          ;(window as Record<string, unknown>).__lastToolItemId = itemId
          break
        }

        case "tool_execution_end": {
          const result = event.result as { content?: Array<{ text?: string }> }
          const isError = event.isError as boolean
          const text = result?.content?.[0]?.text
          const itemId = (window as Record<string, unknown>).__lastToolItemId as string | undefined

          if (itemId && text) {
            const lines = text.split("\n").filter(Boolean)
            const preview = lines.length > 3
              ? lines.slice(0, 3).join("\n") + ` (${lines.length} lines)`
              : text

            setActivityGroups((prev) =>
              prev.map((g) => ({
                ...g,
                items: g.items.map((i) =>
                  i.id === itemId
                    ? { ...i, result: preview.slice(0, 300), isError }
                    : i
                ),
              }))
            )
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

        case "extension_ui_request": {
          const req = event as {
            id: string
            method: string
            title?: string
            message?: string
            options?: string[]
            notifyType?: string
            statusKey?: string
            statusText?: string
          }

          if (req.method === "notify") {
            addMessage({ role: "status", content: `${req.message ?? ""}` })
            break
          }

          if (req.method === "setStatus") {
            if (req.statusText) {
              addMessage({ role: "status", content: req.statusText })
            }
            break
          }

          if (req.method === "setTitle" || req.method === "setWidget" || req.method === "set_editor_text") {
            break
          }

          if (req.method === "confirm") {
            addMessage({
              role: "status",
              content: `Auto-confirmed: ${req.title ?? ""} ${req.message ?? ""}`,
            })
            send({ type: "extension_ui_response", id: req.id, confirmed: true })
            break
          }

          if (req.method === "select") {
            const options = req.options ?? []
            if (options.length > 0) {
              addMessage({
                role: "status",
                content: `Auto-selected: "${options[0]}" for "${req.title ?? ""}"`,
              })
              send({ type: "extension_ui_response", id: req.id, value: options[0] })
            } else {
              send({ type: "extension_ui_response", id: req.id, cancelled: true })
            }
            break
          }

          if (req.method === "input" || req.method === "editor") {
            addMessage({ role: "status", content: `Skipped input: ${req.title ?? ""}` })
            send({ type: "extension_ui_response", id: req.id, cancelled: true })
            break
          }

          send({ type: "extension_ui_response", id: req.id, cancelled: true })
          break
        }
      }
    })
  }, [onEvent, addMessage, updateMessage, send])

  // ── Stop ─────────────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    abort()
    if (currentAssistantRef.current) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === currentAssistantRef.current ? { ...m, streaming: false } : m
        )
      )
      currentAssistantRef.current = null
    }
    currentGroupRef.current = null
    addMessage({ role: "status", content: "Stopped" })
  }, [abort, addMessage])

  // ── Inspect page ─────────────────────────────────────────────────────────

  const inspectPage = useCallback(async () => {
    const res = await new Promise<{ ok: boolean; context?: { url: string; title: string }; tabs?: unknown[] }>((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAGE_CONTEXT" }, (r) => resolve(r ?? { ok: false }))
    })
    if (res?.ok && res.context) {
      addMessage({
        role: "status",
        content: `Page: ${res.context.title}\n${res.context.url}`,
      })
    }
  }, [addMessage])

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

  // Format model display name
  const modelLabel = currentModel
    ? `${currentModel.provider} / ${currentModel.name}`
    : "No model"

  return (
    <div className="flex flex-col h-screen w-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <PiLogo className="h-4 w-4 text-white" />
          <span className="font-semibold text-sm">Pi</span>
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
              setActivityGroups([])
              currentGroupRef.current = null
            }}
            title="New session"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Model selector bar */}
      {connected && (
        <div className="relative px-2.5 py-1 border-b" ref={dropdownRef}>
          <button
            onClick={() => setModelDropdownOpen((v) => !v)}
            className="flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-md hover:bg-muted/50 transition-colors text-xs text-muted-foreground"
          >
            <Sparkles className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1">{modelLabel}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {modelDropdownOpen && models.length > 0 && (
            <div className="absolute left-1 right-1 z-50 mt-1 max-h-[280px] overflow-y-auto rounded-lg border bg-popover shadow-lg">
              {models.map((m) => {
                const isActive = currentModel?.id === m.id && currentModel?.provider === m.provider
                return (
                  <button
                    key={`${m.provider}/${m.id}`}
                    onClick={() => handleModelSelect(m)}
                    className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-muted/50 ${
                      isActive ? "text-foreground bg-muted/40" : "text-muted-foreground"
                    }`}
                  >
                    {isActive && <Sparkles className="h-3 w-3 shrink-0" />}
                    {!isActive && <span className="w-3" />}
                    <span className="truncate">
                      <span className="text-muted-foreground">{m.provider}</span>
                      <span className="text-muted-foreground/50"> / </span>
                      <span className={isActive ? "text-foreground" : ""}>{m.name}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 py-2">
        {messages.length === 0 && activityGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-12 text-muted-foreground">
            <PiLogo className="h-10 w-10 mb-3 text-white" />
            <div className="text-sm font-medium mb-1">Hi! I'm Pi.</div>
            <div className="text-xs">
              Ask me anything, or tell me to interact with the page.
              <br />
              I can see and control all your browser tabs.
              <br />
              Try: "Summarize this page" or "Check my Gmail"
            </div>
            {!connected && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
                Bridge not connected. Run:<br />
                <code className="font-mono">pi-chrome start</code>
              </div>
            )}
          </div>
        )}
        {(() => {
          // Build a render list interleaving messages and activity groups
          // Activity groups are placed after the assistant message whose streaming ended before the group started
          // Simple approach: track a "group index" and insert groups between messages by timestamp
          type RenderItem =
            | { kind: "message"; message: ChatMessageType }
            | { kind: "activity"; group: ActivityGroup; index: number }

          const items: RenderItem[] = []
          let groupIdx = 0

          for (const m of messages) {
            // Skip tool messages (they're in activity groups now)
            if (m.role === "tool") continue

            // Insert any activity groups that started before this message
            while (groupIdx < activityGroups.length) {
              const group = activityGroups[groupIdx]
              const groupTime = group.items[0]?.timestamp ?? Infinity
              if (groupTime < m.timestamp) {
                items.push({ kind: "activity", group, index: groupIdx })
                groupIdx++
              } else {
                break
              }
            }

            items.push({ kind: "message", message: m })
          }

          // Remaining activity groups after all messages
          while (groupIdx < activityGroups.length) {
            items.push({ kind: "activity", group: activityGroups[groupIdx], index: groupIdx })
            groupIdx++
          }

          return items.map((item) =>
            item.kind === "message" ? (
              <ChatMessage key={item.message.id} message={item.message} />
            ) : (
              <ActivityBlock
                key={item.group.id}
                group={item.group}
                onToggle={() => {
                  const idx = item.index
                  setActivityGroups((prev) =>
                    prev.map((g, i) =>
                      i === idx ? { ...g, collapsed: !g.collapsed } : g
                    )
                  )
                }}
              />
            )
          )
        })()}
      </ScrollArea>

      {/* Input */}
      <div
        className="border-t px-2 py-2 bg-background"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

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
          {streaming ? (
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
