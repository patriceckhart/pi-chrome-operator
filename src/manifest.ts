import { defineManifest } from "@crxjs/vite-plugin"

export default defineManifest({
  manifest_version: 3,
  name: "Pi Chrome Operator",
  version: "0.1.0",
  description:
    "Chat with Pi AI to control your browser — summarize pages, fill forms, check mail, and save routines.",
  permissions: ["storage", "tabs", "scripting", "activeTab", "sidePanel"],
  host_permissions: ["<all_urls>"],
  action: {
    default_popup: "popup.html",
    default_title: "Pi Operator",
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
  icons: {
    "16": "public/icons/icon-16.png",
    "48": "public/icons/icon-48.png",
    "128": "public/icons/icon-128.png",
  },
})
