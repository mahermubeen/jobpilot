import { gte, sum } from "drizzle-orm";
import { ApifyClient } from "apify-client";
import { getDb, schema } from "@/lib/db";
import { getSecrets, getSettings } from "@/lib/settings";
import { uid } from "@/lib/util";
import { ACTORS, type ActorKey } from "./actors";

export class BudgetError extends Error {}

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Estimated Apify spend recorded by this app since the 1st of the month. */
export async function monthSpendUsd(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sum(schema.spend.usd) })
    .from(schema.spend)
    .where(gte(schema.spend.createdAt, monthStart()));
  return Number(row?.total ?? 0);
}

export function estimateUsd(actor: ActorKey, units: number): number {
  const a = ACTORS[actor];
  return a.usdPerRun + a.usdPerItem * units;
}

async function client(): Promise<ApifyClient> {
  const { apifyToken } = await getSecrets();
  if (!apifyToken) throw new Error("No Apify token saved. Add one in Settings.");
  return new ApifyClient({ token: apifyToken });
}

/**
 * Runs an actor and returns its dataset items.
 * `maxUnits` is the most billable units (jobs, pages) the run may produce; the
 * run is refused when that could push this month's spend over the user's cap.
 */
export async function runActor<T>(
  actor: ActorKey,
  input: Record<string, unknown>,
  maxUnits: number,
  billedUnits?: (items: T[]) => number,
): Promise<T[]> {
  const { caps } = await getSettings();
  const spent = await monthSpendUsd();
  const worstCase = estimateUsd(actor, maxUnits);
  if (spent + worstCase > caps.apifyMonthlyUsd) {
    throw new BudgetError(
      `Skipped ${ACTORS[actor].id}: this run could cost $${worstCase.toFixed(3)} and ` +
        `$${spent.toFixed(2)} of the $${caps.apifyMonthlyUsd.toFixed(2)} monthly cap is used.`,
    );
  }

  const apify = await client();
  const run = await apify.actor(ACTORS[actor].id).call(input, {
    waitSecs: 600,
    timeout: 600,
    // Hard stop on Apify's side as well, with a little headroom over our estimate.
    maxTotalChargeUsd: Math.max(0.01, Number((worstCase * 1.5).toFixed(3))),
  });

  const { items } = await apify
    .dataset(run.defaultDatasetId)
    .listItems({ limit: Math.max(maxUnits * 2, 50), clean: true });
  const typed = items as T[];

  const units = billedUnits ? billedUnits(typed) : typed.length;
  const db = await getDb();
  await db.insert(schema.spend).values({
    id: uid(),
    actor: ACTORS[actor].id,
    items: units,
    usd: estimateUsd(actor, Math.min(units, maxUnits)),
  });

  if (run.status !== "SUCCEEDED" && typed.length === 0) {
    throw new Error(`${ACTORS[actor].id} ended with status ${run.status}.`);
  }
  return typed;
}

/** Real usage numbers from the Apify account, when the token can read them. */
export async function accountUsage(): Promise<{
  usedUsd: number;
  limitUsd: number;
  plan: string;
} | null> {
  try {
    const apify = await client();
    const [limits, user] = await Promise.all([
      apify.user().limits(),
      apify.user().get(),
    ]);
    const l = limits as unknown as {
      limits?: { maxMonthlyUsageUsd?: number };
      current?: { monthlyUsageUsd?: number };
    };
    const u = user as unknown as { plan?: { id?: string } };
    return {
      usedUsd: Number(l?.current?.monthlyUsageUsd ?? 0),
      limitUsd: Number(l?.limits?.maxMonthlyUsageUsd ?? 0),
      plan: String(u?.plan?.id ?? "unknown"),
    };
  } catch {
    return null;
  }
}

export async function testApify(): Promise<string> {
  const apify = await client();
  const me = (await apify.user().get()) as unknown as { username?: string };
  const usage = await accountUsage();
  return usage
    ? `Connected as ${me.username}. $${usage.usedUsd.toFixed(2)} of $${usage.limitUsd.toFixed(2)} used this month.`
    : `Connected as ${me.username}.`;
}
