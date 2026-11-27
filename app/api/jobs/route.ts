import { desc } from "drizzle-orm";
import { HttpError, pick, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { JOB_FIELDS } from "@/lib/fields";
import { jobId, jobKeys } from "@/lib/pipeline/dedupe";
import { undismiss } from "@/lib/pipeline/forget";
import { toPostedAt } from "@/lib/pipeline/cleanup";
import { upsertCompany } from "@/lib/pipeline/steps";
import { today } from "@/lib/util";

export const GET = route(async () => {
  const db = await getDb();
  const jobs = await db.select().from(schema.jobs).orderBy(desc(schema.jobs.updatedAt));
  return { jobs };
});

export const POST = route(async (req: Request) => {
  const data = pick(await req.json(), JOB_FIELDS) as Record<string, unknown>;
  const company = String(data.company ?? "").trim();
  const role = String(data.role ?? "").trim();
  if (!company || !role) throw new HttpError(400, "Company and role are required.");

  const db = await getDb();
  const all = await db
    .select({ id: schema.jobs.id, company: schema.jobs.company, role: schema.jobs.role, link: schema.jobs.link, source: schema.jobs.source, sourceId: schema.jobs.sourceId })
    .from(schema.jobs);
  // One card per job: adding a job that is already on the board returns that one.
  const candidate = { company, role, link: typeof data.link === "string" ? data.link : null, source: null, sourceId: null };
  const keys = new Set(jobKeys(candidate));
  const already = all.find((j) => jobKeys(j).some((k) => keys.has(k)));
  if (already) return { id: already.id, existing: true };
  // Adding a job you deleted before is a choice; searches may find it again too.
  await undismiss(candidate);
  const taken = new Set(all.map((j) => j.id));
  const id = jobId(company, role, taken);
  await db.insert(schema.jobs).values({
    ...(data as object),
    id,
    company,
    role,
    status: String(data.status ?? "Found"),
    found: String(data.found ?? today()),
    postedAt: toPostedAt(data.postedAt),
    flags: Array.isArray(data.flags) ? (data.flags as string[]) : [],
    companyId: await upsertCompany(company),
  });
  return { id };
});
