import { HttpError, route } from "@/lib/api";
import { profileIsReady } from "@/lib/cv/types";
import { ensureTitleVariants } from "@/lib/pipeline/titles";
import { getProfile, getSettings } from "@/lib/settings";

/**
 * Makes the AI title variants now, from the titles on screen (which may not be
 * saved yet). Saves the variants and returns them.
 */
export const POST = route(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { titles?: unknown; excludedVariants?: unknown };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((t) => t.trim()).filter(Boolean) : undefined);
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  if (!profileIsReady(profile)) throw new HttpError(400, "Add your CV first, so the titles fit your experience.");
  const titles = list(body.titles) ?? settings.search.titles;
  if (!titles.length) throw new HttpError(400, "Add at least one job title first.");
  const lines: string[] = [];
  const next = await ensureTitleVariants(
    { ...settings, search: { ...settings.search, titles, excludedVariants: list(body.excludedVariants) ?? settings.search.excludedVariants } },
    profile,
    (l) => lines.push(l),
    true,
  );
  if (next.search.variantsKey === settings.search.variantsKey && lines.some((l) => l.startsWith("Could not"))) {
    throw new HttpError(502, lines.join(" "));
  }
  return { titleVariants: next.search.titleVariants, variantsKey: next.search.variantsKey };
});
