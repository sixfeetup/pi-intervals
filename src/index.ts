import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createRuntime } from "./runtime.js";
import { registerIntervalsTools } from "./tools.js";
import { registerIntervalsCommands } from "./commands.js";

export default function intervalsExtension(pi: ExtensionAPI) {
  const runtime = createRuntime();
  registerIntervalsTools(runtime, pi);
  registerIntervalsCommands(runtime, pi);
  pi.on("session_shutdown", async () => runtime.close());
}
