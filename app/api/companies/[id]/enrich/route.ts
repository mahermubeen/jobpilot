import { route, type IdParams } from "@/lib/api";
import { enrichCompanies } from "@/lib/pipeline/steps";

/** Looks up website, public emails and phone for one company on demand. */
export const POST = route(async (_req: Request, { params }: IdParams) => {
  const { id } = await params;
  const log: string[] = [];
  const done = await enrichCompanies([id], (line) => log.push(line));
  return { ok: done > 0, log };
});
