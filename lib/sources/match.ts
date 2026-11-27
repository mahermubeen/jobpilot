/**
 * Title matching for sources that hand back everything (feeds, career pages,
 * social posts) rather than searching by title themselves.
 */

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bfull[\s-]?stack\b/g, "fullstack")
    .replace(/\bfront[\s-]?end\b/g, "frontend")
    .replace(/\bback[\s-]?end\b/g, "backend")
    .replace(/\bnode[\s.]?js\b/g, "nodejs")
    .replace(/\breact[\s.]?js\b/g, "react")
    .replace(/\bvue[\s.]?js\b/g, "vue")
    .replace(/\bnext[\s.]?js\b/g, "nextjs")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

const SAME: Record<string, string> = {
  sr: "senior", snr: "senior", jr: "junior", dev: "developer", devs: "developer", developers: "developer",
  engineer: "developer", engineers: "developer", eng: "developer", programmer: "developer",
  swe: "software developer", mgr: "manager", js: "javascript", ts: "typescript", ml: "machine learning",
};

// Words that say how senior a role is or join words together; a title still matches without them.
const IGNORE = new Set([
  "senior", "junior", "lead", "principal", "staff", "mid", "level", "i", "ii", "iii", "iv", "associate",
  "head", "chief", "and", "or", "of", "the", "a", "an", "for", "with", "in", "at", "to", "remote", "hybrid", "onsite",
]);

/** The words in a title that must all appear in a role for it to match. */
export function coreWords(title: string): string[] {
  return [...new Set(
    plain(title)
      .split(" ")
      .flatMap((w) => (SAME[w] ?? w).split(" "))
      .filter((w) => w && !IGNORE.has(w)),
  )];
}

const wordSet = (text: string) =>
  new Set(plain(text).split(" ").flatMap((w) => (SAME[w] ?? w).split(" ")));

/** True when a title-like text contains a word from the user's skip list. */
export function excludedTitle(role: string, exclude: string[]): boolean {
  const words = wordSet(role);
  return exclude.some((w) => {
    const core = coreWords(w);
    return core.length > 0 && core.every((c) => words.has(c));
  });
}

/** The first search title whose words all appear in `text`, or null. */
export function matchingTitle(text: string, titles: string[]): string | null {
  const words = wordSet(text);
  for (const t of titles) {
    const core = coreWords(t);
    if (core.length && core.every((w) => words.has(w))) return t;
  }
  return null;
}

/** A job title matches when one search title's words all appear in it and no skip word does. */
export function matchesTitle(role: string, titles: string[], exclude: string[] = []): boolean {
  return !!matchingTitle(role, titles) && !excludedTitle(role, exclude);
}

/** Search titles followed by AI variants, without repeats and without the ones the user removed. */
export function searchTitles(search: {
  titles: string[];
  titleVariants?: string[];
  excludedVariants?: string[];
}): string[] {
  const seen = new Set<string>();
  const removed = new Set((search.excludedVariants ?? []).map(plain));
  const out: string[] = [];
  for (const t of [...search.titles, ...(search.titleVariants ?? []).filter((v) => !removed.has(plain(v)))]) {
    const key = coreWords(t).sort().join(" ");
    if (!t.trim() || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.trim());
  }
  return out;
}
