import { HttpError, pick, route } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { CONTACT_FIELDS } from "@/lib/fields";
import { upsertCompany } from "@/lib/pipeline/steps";
import { slug, uid } from "@/lib/util";

export const POST = route(async (req: Request) => {
  const data = pick(await req.json(), CONTACT_FIELDS) as Record<string, unknown>;
  const name = String(data.name ?? "").trim();
  if (!name) throw new HttpError(400, "A name is required.");
  const company = String(data.company ?? "").trim();
  const companyId =
    (data.companyId as string | null) ?? (company ? await upsertCompany(company) : null);
  const db = await getDb();
  const id = `${slug(`${name} ${company}`, "contact")}-${uid().slice(0, 4)}`;
  await db.insert(schema.contacts).values({
    ...(data as object),
    id,
    name,
    company: company || null,
    companyId,
    status: String(data.status ?? "To contact"),
    optedOut: !!data.optedOut,
    source: "Manual",
  });
  return { id };
});
