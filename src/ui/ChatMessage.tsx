import { useState } from "react"
import { User, Globe, AlertCircle, Check, XCircle, ChevronDown, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ChatMessage as ChatMessageType } from "@/types"

/**
 * Parse message content into segments of plain text and code blocks.
 */
function parseContent(text: string): Array<{ type: "text" | "code"; lang?: string; content: string }> {
  const segments: Array<{ type: "text" | "code"; lang?: string; content: string }> = []
  const regex = /```(\S*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: "text", content: before })
    }
    segments.push({ type: "code", lang: match[1] || undefined, content: match[2].trim() })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) segments.push({ type: "text", content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }]
}

function MessageContent({ content }: { content: string }) {
  const trimmed = content.replace(/^\s+/, "")
  const segments = parseContent(trimmed)

  if (segments.length === 1 && segments[0].type === "text") {
    return <div className="whitespace-pre-wrap break-words">{trimmed}</div>
  }

  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <div key={i} className="rounded-md bg-black/30 border border-white/5 overflow-hidden">
            {seg.lang && (
              <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-white/5 font-mono">
                {seg.lang}
              </div>
            )}
            <pre className="px-3 py-2 text-xs font-mono overflow-x-auto">
              <code>{seg.content}</code>
            </pre>
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap break-words">{seg.content}</div>
        )
      )}
    </div>
  )
}

// ── Activity item (tool call + result) ──────────────────────────────────────

export type ActivityItem = {
  id: string
  label: string
  result?: string
  isError?: boolean
  timestamp: number
}

export type ActivityGroup = {
  id: string
  items: ActivityItem[]
  collapsed: boolean
}

export function ActivityBlock({ group, onToggle }: { group: ActivityGroup; onToggle: () => void }) {
  const count = group.items.length
  const hasErrors = group.items.some((i) => i.isError)

  return (
    <div className="mx-2 my-1">
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors",
          "border bg-neutral-900/80 hover:bg-neutral-800/80",
          hasErrors ? "border-red-900/50 text-red-400" : "border-neutral-800 text-neutral-400"
        )}
      >
        {group.collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        <Globe className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {count === 1 ? group.items[0].label : `${count} actions`}
        </span>
        {hasErrors && <XCircle className="h-3 w-3 shrink-0 ml-auto" />}
      </button>

      {!group.collapsed && (
        <div className="mt-1 ml-2 border-l border-neutral-800 pl-2.5 space-y-1">
          {group.items.map((item) => (
            <div key={item.id} className="text-xs">
              {/* Action label */}
              <div className="flex items-center gap-1.5 text-neutral-400 font-mono py-0.5">
                <Globe className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              {/* Result */}
              {item.result && (
                <div className={cn(
                  "flex items-start gap-1.5 pl-4 py-0.5",
                  item.isError ? "text-red-400" : "text-neutral-500"
                )}>
                  {item.isError ? (
                    <XCircle className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                  ) : (
                    <Check className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                  )}
                  <span className="break-all line-clamp-3">{item.result}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Status message ──────────────────────────────────────────────────────────

function StatusMessage({ content }: { content: string }) {
  const isError = content.startsWith("[error]")
  const isOk = content.startsWith("[ok]")
  const displayContent = isError
    ? content.slice(7).trimStart()
    : isOk
    ? content.slice(4).trimStart()
    : content

  const StatusIcon = isError ? XCircle : isOk ? Check : AlertCircle

  return (
    <div className={cn(
      "flex items-start gap-2 px-3 py-1 text-xs",
      isError ? "text-red-400" : "text-muted-foreground"
    )}>
      <StatusIcon className="h-3 w-3 shrink-0 mt-0.5" />
      <span>{displayContent}</span>
    </div>
  )
}

// ── Main ChatMessage component ──────────────────────────────────────────────

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isSystem = message.role === "system"

  if (message.role === "status") {
    return <StatusMessage content={message.content} />
  }

  // Tool messages are now handled by ActivityBlock, skip them here
  if (message.role === "tool") return null

  return (
    <div className={cn("flex gap-2 px-2 py-2", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      {isUser ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
          <User className="h-3 w-3" />
        </div>
      ) : (
        <img
          src={chrome.runtime.getURL("public/icons/icon-48.png")}
          alt="Assistant"
          className="h-6 w-6 shrink-0 rounded-full"
        />
      )}

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed",
          isUser && "bg-primary text-primary-foreground rounded-br-sm",
          isAssistant && "bg-muted rounded-bl-sm",
          isSystem && "bg-muted/50 text-muted-foreground text-xs italic"
        )}
      >
        {/* Images */}
        {message.images && message.images.length > 0 && (
          <div className={cn("flex flex-wrap gap-1.5", message.content && "mb-2")}>
            {message.images.map((img) => (
              <img
                key={img.id}
                src={img.preview}
                alt={img.name ?? "image"}
                className="max-w-[200px] max-h-[160px] rounded-lg object-cover border border-white/10"
              />
            ))}
          </div>
        )}

        {/* Text */}
        {message.streaming && !message.content ? (
          <span className="inline-flex gap-1">
            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
            <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
            <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
          </span>
        ) : message.content ? (
          <MessageContent content={message.content} />
        ) : null}
      </div>
    </div>
  )
}
