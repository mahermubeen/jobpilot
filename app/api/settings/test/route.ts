import { HttpError, route } from "@/lib/api";
import { AI_CATALOG, type AiKind } from "@/lib/ai/catalog";
import { providerFor, unpark } from "@/lib/ai/chain";
import { complete, getProvider } from "@/lib/ai/provider";
import { getSecrets, getSettings } from "@/lib/settings";
import { testSmtp } from "@/lib/mail/smtp";
import { testApollo } from "@/lib/sources/apollo";
import { testApify } from "@/lib/sources/apify";
import { errorMessage } from "@/lib/util";

const tests: Record<string, () => Promise<string>> = {
  ai: async () => {
    const provider = await getProvider();
    const reply = await complete("Reply with the single word: ready", "score");
    return `${provider.name} answered "${reply.trim().slice(0, 40)}".`;
  },
  apify: testApify,
  gmail: testSmtp,
  apollo: testApollo,
};

/** Tests one AI on its own, skipping the chain, and clears it if it was set aside. */
async function testOneAi(kind: AiKind): Promise<string> {
  if (!AI_CATALOG[kind]) throw new HttpError(400, "Unknown AI.");
  const [{ ai }, secrets] = await Promise.all([getSettings(), getSecrets()]);
  const entry = ai.chain.find((e) => e.kind === kind)!;
  const provider = providerFor(entry, secrets);
  const reply = await provider.complete("Reply with the single word: ready", { tier: "score" });
  await unpark([kind]);
  return `Connected. ${entry.score} answered "${reply.trim().slice(0, 40)}".`;
}

export const POST = route(async (req: Request) => {
  const { target } = (await req.json()) as { target: string };
  const test = target.startsWith("ai:") ? () => testOneAi(target.slice(3) as AiKind) : tests[target];
  if (!test) throw new HttpError(400, "Unknown connection.");
  try {
    return { ok: true, message: await test() };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
});
