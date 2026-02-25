import { useCallback, useEffect, useState } from "react"
import { DEFAULT_SETTINGS, type Settings } from "@/types"

const KEY = "pi_settings"

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    chrome.storage.local.get([KEY], (data) => {
      if (data[KEY]) setSettings({ ...DEFAULT_SETTINGS, ...data[KEY] })
    })
  }, [])

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      chrome.storage.local.set({ [KEY]: next })
      return next
    })
  }, [])

  return { settings, updateSettings }
}
