import { route } from "@/lib/api";
import { chainStatus, getUsage } from "@/lib/ai/chain";
import { detectAi } from "@/lib/ai/detect";
import { getSettings } from "@/lib/settings";

/** For Settings → AI: what is installed here, each AI's state in the chain, and today's calls. */
export const GET = route(async () => {
  const { ai } = await getSettings();
  const ollama = ai.chain.find((e) => e.kind === "ollama");
  const [found, status, usage] = await Promise.all([detectAi(ollama?.baseUrl), chainStatus(), getUsage()]);
  return { found, status, usage };
});
