/**
 * Imports jobs exported from the old Job Board artifact (one JSON file per job).
 *
 *   npx tsx scripts/import-artifact.ts <folder-with-json-files>
 *
 * Safe to run twice: jobs that already exist are left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "../lib/db";
import { upsertCompany } from "../lib/pipeline/steps";

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: npx tsx scripts/import-artifact.ts <folder-with-json-files>");
    process.exit(1);
  }
  const db = await getDb();
  const existing = new Set((await db.select({ id: schema.jobs.id }).from(schema.jobs)).map((j) => j.id));
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  let added = 0;
  let skipped = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const id = path.basename(file, ".json");
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, unknown>;
    const company = str(j.company);
    const role = str(j.role);
    if (!company || !role || existing.has(id)) {
      skipped++;
      continue;
    }
    await db.insert(schema.jobs).values({
      id,
      company,
      role,
      link: str(j.link),
      status: str(j.status) ?? "Found",
      fit: str(j.fit),
      source: str(j.source),
      pay: str(j.pay),
      tier: str(j.tier),
      mode: str(j.mode),
      location: str(j.location),
      found: str(j.found),
      applied: str(j.applied),
      followUp: str(j.followUp),
      contact: str(j.contact),
      next: str(j.next),
      notes: str(j.notes),
      cover: str(j.cover),
      flags: Array.isArray(j.flags) ? j.flags.map(String) : [],
      companyId: await upsertCompany(company),
      updatedAt: str(j.updated) ? new Date(String(j.updated)) : new Date(),
    });
    added++;
  }
  console.log(`Imported ${added} jobs, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
