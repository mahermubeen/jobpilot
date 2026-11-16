import { desc } from "drizzle-orm";
import { HttpError, pick, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { JOB_FIELDS } from "@/lib/fields";
import { jobId } from "@/lib/pipeline/dedupe";
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
  const taken = new Set((await db.select({ id: schema.jobs.id }).from(schema.jobs)).map((j) => j.id));
  const id = jobId(company, role, taken);
  await db.insert(schema.jobs).values({
    ...(data as object),
    id,
    company,
    role,
    status: String(data.status ?? "Found"),
    found: String(data.found ?? today()),
    flags: Array.isArray(data.flags) ? (data.flags as string[]) : [],
    companyId: await upsertCompany(company),
  });
  return { id };
});
