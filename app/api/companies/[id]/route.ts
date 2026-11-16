import { eq } from "drizzle-orm";
import { pick, route, type IdParams } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { COMPANY_FIELDS } from "@/lib/fields";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const { id } = await params;
  const patch = pick(await req.json(), COMPANY_FIELDS) as Record<string, unknown>;
  if (patch.name == null) delete patch.name;
  const db = await getDb();
  await db
    .update(schema.companies)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.companies.id, id));
  return { ok: true };
});
