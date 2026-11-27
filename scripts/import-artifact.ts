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
import { companyId } from "../lib/pipeline/dedupe";
import { upsertCompany } from "../lib/pipeline/steps";
import { chunk } from "../lib/util";

const INSERT_BATCH = 100;

type Exported = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const TEXT_FIELDS = [
  "link", "fit", "source", "pay", "tier", "mode", "location", "found", "applied", "followUp", "contact", "next", "notes", "cover",
] as const;

/** One exported job as a jobs row (the company id is filled in later). */
function toRow(id: string, j: Exported, company: string, role: string) {
  const text = Object.fromEntries(TEXT_FIELDS.map((k) => [k, str(j[k])])) as Record<(typeof TEXT_FIELDS)[number], string | null>;
  return {
    id,
    company,
    role,
    ...text,
    status: str(j.status) ?? "Found",
    flags: Array.isArray(j.flags) ? j.flags.map(String) : [],
    updatedAt: str(j.updated) ? new Date(String(j.updated)) : new Date(),
  };
}

/** Reads every JSON file, keeping new jobs that have a company and a role. */
function readJobs(dir: string, existing: Set<string>) {
  const rows: ReturnType<typeof toRow>[] = [];
  let skipped = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const id = path.basename(file, ".json");
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Exported;
    const company = str(j.company);
    const role = str(j.role);
    if (!company || !role || existing.has(id)) skipped++;
    else rows.push(toRow(id, j, company, role));
  }
  return { rows, skipped };
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    console.error("Usage: npx tsx scripts/import-artifact.ts <folder-with-json-files>");
    process.exit(1);
  }
  const db = await getDb();
  const existing = new Set((await db.select({ id: schema.jobs.id }).from(schema.jobs)).map((j) => j.id));
  const { rows, skipped } = readJobs(dir, existing);

  // One upsert per company (names that share an id upsert once), all at the same time.
  // The first file's spelling names the company, as when they were imported one by one.
  const byId = new Map<string, string>();
  for (const r of rows) if (!byId.has(companyId(r.company))) byId.set(companyId(r.company), r.company);
  await Promise.all([...byId.values()].map((name) => upsertCompany(name)));
  const withCompany = rows.map((r) => ({ ...r, companyId: companyId(r.company) }));
  await Promise.all(chunk(withCompany, INSERT_BATCH).map((batch) => db.insert(schema.jobs).values(batch)));

  console.log(`Imported ${rows.length} jobs, skipped ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
