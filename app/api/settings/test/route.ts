import { HttpError, route } from "@/lib/api";
import { complete, getProvider } from "@/lib/ai/provider";
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

export const POST = route(async (req: Request) => {
  const { target } = (await req.json()) as { target: string };
  const test = tests[target];
  if (!test) throw new HttpError(400, "Unknown connection.");
  try {
    return { ok: true, message: await test() };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
});
