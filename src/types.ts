// ── Browser actions (executed by content script) ────────────────────────────
export type BrowserAction =
  | { type: "navigate"; url: string }
  | { type: "click"; selector: string; text?: string }
  | { type: "type"; selector: string; text: string; submit?: boolean }
  | { type: "select"; selector: string; value: string }
  | { type: "wait"; ms: number }
  | { type: "scroll"; direction: "up" | "down"; amount?: number }
  | { type: "extract"; selector?: string; description?: string }
  | { type: "screenshot" }

// ── Image attachment ────────────────────────────────────────────────────────
export type ImageAttachment = {
  id: string
  data: string       // base64
  mimeType: string   // image/png, image/jpeg, etc.
  name?: string
  preview: string    // data URL for display
}

// ── Chat messages (UI state) ────────────────────────────────────────────────
export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system" | "tool" | "status"
  content: string
  images?: ImageAttachment[]
  timestamp: number
  streaming?: boolean
}

// ── Routines ────────────────────────────────────────────────────────────────
export type Routine = {
  id: string
  name: string
  description: string
  prompt: string
  icon?: string
  createdAt: number
}

// ── Settings ────────────────────────────────────────────────────────────────
export type Settings = {
  bridgeUrl: string
  autoRun: boolean
  theme: "light" | "dark" | "system"
}

export const DEFAULT_SETTINGS: Settings = {
  bridgeUrl: "ws://localhost:9224",
  autoRun: false,
  theme: "system",
}

// ── Page context (sent to Pi so it knows what page we're on) ────────────────
export type PageContext = {
  url: string
  title: string
  html?: string
  text?: string
  links?: { text: string; href: string }[]
  inputs?: { selector: string; type: string; name: string; placeholder: string; value: string }[]
  buttons?: { selector: string; text: string }[]
}
