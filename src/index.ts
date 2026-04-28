import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRuntime } from "./runtime.js";

export default function intervalsExtension(pi: ExtensionAPI) {
  const runtime = createRuntime();
  pi.on("session_shutdown", async () => runtime.close());
}
