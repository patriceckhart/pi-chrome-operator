import { Settings as SettingsIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Settings } from "@/types"

type Props = {
  settings: Settings
  onChange: (partial: Partial<Settings>) => void
  onBack: () => void
}

export function SettingsPanel({ settings, onChange, onBack }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <SettingsIcon className="h-4 w-4" />
          Settings
        </div>
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← Chat
        </Button>
      </div>

      <div className="p-3 space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Pi Bridge URL</label>
          <Input
            value={settings.bridgeUrl}
            onChange={(e) => onChange({ bridgeUrl: e.target.value })}
            placeholder="ws://localhost:9224"
          />
          <p className="text-xs text-muted-foreground">
            WebSocket URL of the Pi RPC bridge server
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Auto-run browser actions</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.autoRun}
              onChange={(e) => onChange({ autoRun: e.target.checked })}
              className="rounded border-input"
            />
            <span className="text-sm text-muted-foreground">
              Execute browser actions without confirmation
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1.5">
          <div className="font-medium">How to start the bridge:</div>
          <code className="block bg-background rounded px-2 py-1.5 text-[11px]">
            cd pi-chrome-operator<br />
            npx tsx server/bridge.ts
          </code>
          <p className="text-muted-foreground">
            The bridge spawns Pi in RPC mode and relays messages over WebSocket.
            Pi uses your existing API keys and settings.
          </p>
        </div>
      </div>
    </div>
  )
}
