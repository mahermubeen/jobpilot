/**
 * A job read off the application page itself, for forms that are not one of
 * the saved jobs. It is never stored as a job; its id scopes answers written
 * for this company to this page so they never fill another company's form.
 */

export type PageInfo = { url: string; role: string; company: string; description: string };

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";

export function parsePageJob(input: unknown): PageInfo | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const page = {
    url: text(o.url, 2000),
    role: text(o.role, 200).replace(/\s+/g, " "),
    company: text(o.company, 120).replace(/\s+/g, " "),
    description: text(o.description, 12000),
  };
  return page.url || page.role || page.company ? page : null;
}

/** "page:jethr.com/join/ai-engineer": host and path, without query or hash. */
export function pageScope(url: string): string {
  try {
    const u = new URL(url);
    return `page:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return `page:${url.split(/[?#]/)[0].slice(0, 200)}`;
  }
}

export function pageJob(page: PageInfo) {
  return {
    id: pageScope(page.url),
    company: page.company,
    role: page.role,
    description: page.description || null,
    location: null,
    mode: null,
    cover: null,
    source: "Extension",
  };
}
