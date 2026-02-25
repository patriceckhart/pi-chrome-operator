import { Play, Trash2, Plus, BookOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Routine } from "@/types"
import { useState } from "react"

type Props = {
  routines: Routine[]
  onRun: (prompt: string) => void
  onSave: (name: string, prompt: string) => void
  onDelete: (id: string) => void
  onBack: () => void
}

export function RoutinePanel({ routines, onRun, onSave, onDelete, onBack }: Props) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPrompt, setNewPrompt] = useState("")

  const handleSave = () => {
    if (!newName.trim() || !newPrompt.trim()) return
    onSave(newName.trim(), newPrompt.trim())
    setNewName("")
    setNewPrompt("")
    setShowNew(false)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <BookOpen className="h-4 w-4" />
          Routines
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowNew(!showNew)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onBack}>
            ← Chat
          </Button>
        </div>
      </div>

      {showNew && (
        <div className="p-3 border-b space-y-2 bg-muted/30">
          <Input
            placeholder="Routine name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Textarea
            placeholder="What should Pi do?"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            rows={3}
          />
          <Button size="sm" onClick={handleSave} disabled={!newName.trim() || !newPrompt.trim()}>
            Save routine
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {routines.map((r) => (
          <div
            key={r.id}
            className="border rounded-lg p-2.5 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-medium text-sm">{r.name}</div>
              <div className="flex gap-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onRun(r.prompt)}
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                {!r.id.startsWith("builtin-") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => onDelete(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">{r.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
