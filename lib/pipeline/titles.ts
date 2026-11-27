import { createHash } from "node:crypto";
import { expandTitles } from "@/lib/ai/tasks";
import type { Profile } from "@/lib/cv/types";
import { type AppSettings, getSettings, saveSettings } from "@/lib/settings";
import { errorMessage } from "@/lib/util";

/** Changes when the titles or the parts of the CV the variants are made from change. */
export function variantsKeyFor(titles: string[], profile: Profile): string {
  const basis = [
    [...titles].map((t) => t.trim().toLowerCase()).sort().join("|"),
    profile.headline,
    profile.experience.slice(0, 4).map((e) => e.title).join("|"),
    profile.skills.flatMap((s) => s.items).slice(0, 30).join("|"),
  ].join("\n");
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

/**
 * Makes AI title variants when the titles or CV changed since last time (or
 * when `force` is set) and saves them. Returns the settings to search with.
 * A failing AI leaves the previous variants in place.
 */
export async function ensureTitleVariants(
  settings: AppSettings,
  profile: Profile,
  log: (line: string) => void,
  force = false,
): Promise<AppSettings> {
  const s = settings.search;
  if (!s.titles.length || (!s.autoVariants && !force)) return settings;
  const key = variantsKeyFor(s.titles, profile);
  if (!force && key === s.variantsKey) return settings;
  try {
    const variants = await expandTitles(profile, s.titles, s.excludedVariants);
    // Saved on top of the latest settings so edits made meanwhile survive.
    const fresh = await getSettings();
    await saveSettings({ ...fresh, search: { ...fresh.search, titleVariants: variants, variantsKey: key } });
    log(`Made ${variants.length} more job titles to search from your titles and CV`);
    return { ...settings, search: { ...s, titleVariants: variants, variantsKey: key } };
  } catch (err) {
    log(`Could not make more job titles: ${errorMessage(err)}`);
    return settings;
  }
}
