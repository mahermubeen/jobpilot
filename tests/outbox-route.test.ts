import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { DELETE, PATCH } from "@/app/api/outbox/[id]/route";
import { getDb, schema } from "@/lib/db";

// A throwaway embedded database, so these tests never touch the real data/ folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-outbox-"));
process.env.JOBPILOT_DATA_DIR = tmp;
delete process.env.DATABASE_URL;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
async function email(status: string) {
  const id = `o${++n}`;
  await (await getDb()).insert(schema.outbox).values({ id, to: `jordan${n}@acmewidgets.test`, subject: "Hello", body: "Hi.", status });
  return id;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: object) =>
  PATCH(new Request(`http://127.0.0.1:3000/api/outbox/${id}`, { method: "PATCH", body: JSON.stringify(body) }), params(id));
const remove = (id: string) => DELETE(new Request(`http://127.0.0.1:3000/api/outbox/${id}`, { method: "DELETE" }), params(id));
const row = async (id: string) => (await (await getDb()).select().from(schema.outbox).where(eq(schema.outbox.id, id)))[0];

describe("outbox PATCH and DELETE", () => {
  it("edits and approves a waiting email", async () => {
    const id = await email("queued");
    expect((await patch(id, { subject: "New subject", status: "approved" })).status).toBe(200);
    expect(await row(id)).toMatchObject({ subject: "New subject", status: "approved" });
  });

  it("never sets a sent status from the browser", async () => {
    const id = await email("approved");
    await patch(id, { status: "sent" });
    expect((await row(id)).status).toBe("approved");
  });

  it("refuses to change an email that is being sent or was sent", async () => {
    for (const status of ["sending", "sent"]) {
      const id = await email(status);
      const res = await patch(id, { to: "someone@acmewidgets.test" });
      expect(res.status).toBe(400);
      expect((await row(id)).to).not.toBe("someone@acmewidgets.test");
    }
  });

  it("deletes a waiting email", async () => {
    const id = await email("approved");
    expect((await remove(id)).status).toBe(200);
    expect(await row(id)).toBeUndefined();
  });

  it("keeps an email that is being sent or was sent", async () => {
    for (const status of ["sending", "sent"]) {
      const id = await email(status);
      expect((await remove(id)).status).toBe(400);
      expect(await row(id)).toMatchObject({ status });
    }
  });
});
