import { useCallback, useEffect, useState } from "react"
import type { Routine } from "@/types"

const STORAGE_KEY = "pi_routines"

const BUILT_IN_ROUTINES: Routine[] = [
  {
    id: "builtin-check-mail",
    name: "📬 Check my mails",
    description: "Open Gmail, scan recent emails, and give me a summary of what's important",
    prompt:
      "Go to Gmail (https://mail.google.com). Look at my recent emails. Tell me what's important and summarize the key messages. Focus on action items and urgent things.",
    icon: "📬",
    createdAt: 0,
  },
  {
    id: "builtin-summarize",
    name: "📝 Summarize this page",
    description: "Read the current page and give me a concise summary",
    prompt:
      "Look at the current page I have open and give me a clear, concise summary. Highlight the key points and any important details.",
    icon: "📝",
    createdAt: 0,
  },
  {
    id: "builtin-fill-form",
    name: "📋 Help me fill this form",
    description: "Analyze the current form and help me fill it out",
    prompt:
      "Look at the current page. There should be a form. Tell me what fields are present and help me fill them out. Ask me for any information you need.",
    icon: "📋",
    createdAt: 0,
  },
  {
    id: "builtin-find-contact",
    name: "🔍 Find contact info",
    description: "Find contact information on the current website",
    prompt:
      "Look at the current website and find contact information — email, phone, address, contact form. Summarize what you find.",
    icon: "🔍",
    createdAt: 0,
  },
]

export function useRoutines() {
  const [routines, setRoutines] = useState<Routine[]>([])

  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const saved = (data[STORAGE_KEY] as Routine[]) ?? []
      setRoutines([...BUILT_IN_ROUTINES, ...saved])
    })
  }, [])

  const saveRoutine = useCallback(
    (name: string, prompt: string, description?: string) => {
      const routine: Routine = {
        id: crypto.randomUUID(),
        name,
        description: description ?? prompt.slice(0, 80),
        prompt,
        createdAt: Date.now(),
      }
      const userRoutines = routines.filter((r) => !r.id.startsWith("builtin-"))
      const next = [routine, ...userRoutines]
      chrome.storage.local.set({ [STORAGE_KEY]: next })
      setRoutines([...BUILT_IN_ROUTINES, ...next])
      return routine
    },
    [routines]
  )

  const deleteRoutine = useCallback(
    (id: string) => {
      if (id.startsWith("builtin-")) return
      const userRoutines = routines.filter((r) => !r.id.startsWith("builtin-") && r.id !== id)
      chrome.storage.local.set({ [STORAGE_KEY]: userRoutines })
      setRoutines([...BUILT_IN_ROUTINES, ...userRoutines])
    },
    [routines]
  )

  return { routines, saveRoutine, deleteRoutine }
}
