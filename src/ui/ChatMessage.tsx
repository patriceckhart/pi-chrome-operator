import { User, Terminal, AlertCircle } from "lucide-react"
import { PiLogo } from "@/components/PiLogo"
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
    // Text before this code block
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) segments.push({ type: "text", content: before })
    }
    segments.push({ type: "code", lang: match[1] || undefined, content: match[2].trim() })
    lastIndex = match.index + match[0].length
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining) segments.push({ type: "text", content: remaining })
  }

  return segments.length > 0 ? segments : [{ type: "text", content: text }]
}

function MessageContent({ content }: { content: string }) {
  const segments = parseContent(content)

  // No code blocks, render as plain text
  if (segments.length === 1 && segments[0].type === "text") {
    return <div className="whitespace-pre-wrap break-words">{content}</div>
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

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isTool = message.role === "tool"
  const isStatus = message.role === "status"
  const isSystem = message.role === "system"

  if (isStatus) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span>{message.content}</span>
      </div>
    )
  }

  return (
    <div className={cn("flex gap-2 px-2 py-2", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
          isUser && "bg-primary text-primary-foreground",
          isAssistant && "bg-muted text-white",
          isTool && "bg-amber-900 text-amber-300",
          isSystem && "bg-gray-700 text-gray-300"
        )}
      >
        {isUser ? <User className="h-3 w-3" /> : isTool ? <Terminal className="h-3 w-3" /> : <PiLogo className="h-3 w-3" />}
      </div>

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed",
          isUser && "bg-primary text-primary-foreground rounded-br-sm",
          isAssistant && "bg-muted rounded-bl-sm",
          isTool && "bg-amber-950 border border-amber-800 rounded-bl-sm font-mono text-xs",
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
