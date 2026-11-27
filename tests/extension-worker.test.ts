// @vitest-environment happy-dom
//
// Characterisation tests for the extension's background worker: one "Fill this
// page" press, the tab-to-job link and learning. Chrome, the tab and the local JobPilot app are fakes; page
// functions the worker injects run against happy-dom's document, as they would in the tab.
import { describe, expect, it, vi } from "vitest";
import { type FakeChrome, fakeApp, fakeChrome, type Frame, type Injection, type Route, source, installFakeClock } from "./helpers/extension";

installFakeClock();

// ---------------------------------------------------------------- background

/** Loads background.js and returns a way to send it a message the way Chrome does. */
function startWorker() {
  new Function(source("background.js"))();
  return (fc: FakeChrome, msg: unknown, sender: unknown = {}) =>
    new Promise<unknown>((resolve) => {
      const keepOpen = fc.listeners.message[0](msg, sender, resolve);
      if (keepOpen !== true) resolve(undefined);
    });
}
/** Runs a message to the end, moving fake time on so polling waits finish. */
async function settle<T>(p: Promise<T>, ms = 5000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return p;
}
/** The banners the worker showed, in order. */
const banners = (fc: FakeChrome) =>
  fc.calls.injections.filter((i) => i.args && i.args.length === 2 && typeof i.args[0] === "string").map((i) => i.args);

const FIELDS_TOP = [
  { id: "jp1", label: "First name", type: "text", required: true },
  { id: "jp2", label: "Resume/CV", type: "file", required: true },
  { id: "jp3", label: "Hear about us", type: "select", options: ["LinkedIn", "Other"] },
];
const FIELDS_FRAME = [
  { id: "jp1", label: "Why this job?", type: "textarea", required: true },
  { id: "jp2", label: "Send me marketing emails", type: "checkbox" },
  { id: "jp3", label: "Referrer", type: "text" },
];

/** Tab frames: the top page with three fields, an embedded form with three, and one that cannot be read. */
function formFrames(fillResults: (frameId: number, answers: { id: string; value: unknown }[]) => unknown[]) {
  return (inj: Injection): Frame[] => {
    if (inj.files) return [];
    const fn = String(inj.func);
    if (fn.includes(".collect()")) {
      return [
        { frameId: 0, result: { fields: FIELDS_TOP, wantsCv: true } },
        { frameId: 3, result: { fields: FIELDS_FRAME, wantsCv: false } },
        { frameId: 5, result: null },
      ];
    }
    if (fn.includes(".fill(")) {
      const frameId = inj.target.frameIds![0];
      return [{ frameId, result: fillResults(frameId, inj.args![0] as { id: string; value: unknown }[]) }];
    }
    if (inj.func && inj.args === undefined) return [{ frameId: 0, result: inj.func() }];
    return [{ frameId: 0, result: undefined }];
  };
}

const ANSWERS = [
  { id: "0:jp1", value: "Alex", source: "profile" },
  { id: "0:jp2", value: null, source: "cv" },
  { id: "0:jp3", value: "LinkedIn", source: "bank" },
  { id: "3:jp1", value: "I like the product.", source: "ai" },
  { id: "3:jp2", value: null, source: "bank", skip: true, rule: "marketing-optin" },
  { id: "3:jp3", value: null, source: "none" },
];
const STATS = { aiCalls: 1, inTokens: 12_400, outTokens: 312, aiName: "Claude Code", profile: 1, bank: 1, ai: 1 };

function appWithAnswers(extra: Record<string, Route> = {}) {
  let polls = 0;
  return fakeApp({
    "POST /api/apply/answers": () => ({ ticket: "t-1" }),
    "GET /api/apply/answers": () => (++polls < 2 ? { pending: true } : { answers: ANSWERS, stats: STATS }),
    "GET /api/jobs/job-1/cv": () =>
      new Response(new Uint8Array(70_000).fill(65), { headers: { "content-disposition": 'attachment; filename="Alex Doe - CV.pdf"' } }),
    "GET /api/apply/cv": () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: {} }),
    "GET /api/apply/context": () => ({}),
    ...extra,
  });
}

const fillResultsFor = (frameId: number, answers: { id: string; value: unknown }[]) =>
  answers.map((a) => ({
    label: `${frameId}/${a.id}`,
    status: a.value === null ? (frameId === 0 ? "filled" : "blank") : a.id === "jp3" ? "check" : "filled",
    required: frameId === 3 && a.id === "jp1",
    source: "x",
    value: String(a.value ?? ""),
  }));

describe("background: one Fill press", () => {
  it("reads every frame, asks for answers, attaches the CV, fills each frame and reports", async () => {
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    const app = appWithAnswers();
    const send = startWorker();
    const reply = await settle(send(fc, { type: "fill", tabId: 7, jobId: "job-1", jobLabel: "Acme Widgets · Engineer", attachCv: true }));
    expect(reply).toMatchSnapshot("reply");
    expect(app.seen).toMatchSnapshot("requests to JobPilot");
    const fills = fc.calls.injections.filter((i) => String(i.func).includes(".fill("));
    expect(fills.map((i) => [i.target.frameIds, i.args![0]])).toMatchSnapshot("answers per frame");
    const cv = fills[0].args![1] as { name: string; base64: string };
    expect(cv.name).toBe("Alex Doe - CV.pdf");
    expect(Buffer.from(cv.base64, "base64").length).toBe(70_000);
    expect(fc.calls.injections[0].files).toBeTruthy();
    expect(banners(fc)).toMatchSnapshot("banners");
    expect(fc.session.get("report:7")).toMatchSnapshot("saved report");
    expect(fc.session.get("job:7")).toBe("job-1");
  });

  it("uses what the page says about the job when it is not a saved one", async () => {
    document.head.innerHTML = `<meta property="og:site_name" content="Globex Careers">`;
    document.body.innerHTML = `
      <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["JobPosting"],"title":"Platform Engineer","hiringOrganization":{"name":"Globex"},"description":"<p>Build things.</p><ul><li>Node</li><li>Postgres</li></ul>"}]}</script>
      <h1>Ignored heading</h1><main>Main text</main>`;
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    const app = appWithAnswers();
    const send = startWorker();
    await settle(send(fc, { type: "fill", tabId: 7, jobId: "", attachCv: true }));
    const report = fc.session.get("report:7") as Record<string, unknown>;
    expect(report.page).toMatchSnapshot("page read from the tab");
    expect(report.job).toBe("From this page · Globex · Platform Engineer");
    expect(app.seen.find((r) => r.path.startsWith("/api/apply/cv"))?.path).toBe("/api/apply/cv?role=Platform%20Engineer&company=Globex");
    expect(app.seen.find((r) => r.method === "POST")?.body).toMatchObject({ jobId: null, page: { role: "Platform Engineer" }, forceAi: false });
  });

  it("falls back to the heading, meta tags and main text without a JobPosting", async () => {
    document.head.innerHTML = `<meta name="og:title" content="Meta role"><title>Doc title</title>`;
    document.body.innerHTML = `<h1>Data Engineer</h1><main>About the role\n\n\n\nWhat you'll do</main>`;
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    appWithAnswers();
    const send = startWorker();
    await settle(send(fc, { type: "readPage", tabId: 7 }));
    const page = (await settle(send(fc, { type: "readPage", tabId: 7 }))) as Record<string, string>;
    expect(page).toMatchObject({ role: "Data Engineer", url: "http://localhost:3000/" });
    expect(page.description).not.toMatch(/\n{3,}/);
  });

  it("reads the tab's title when the page cannot be reached", async () => {
    const fc = fakeChrome({ frames: () => { throw new Error("cannot access"); } });
    const send = startWorker();
    expect(await settle(send(fc, { type: "readPage", tabId: 7 }))).toEqual({
      url: "https://jobs.example/apply/1", role: "Apply · Acme Widgets", company: "", description: "",
    });
  });

  it("says so when the page has no empty fields", async () => {
    const fc = fakeChrome({ frames: (inj) => (String(inj.func).includes(".collect()") ? [{ frameId: 0, result: { fields: [], wantsCv: false } }] : []) });
    appWithAnswers();
    const send = startWorker();
    expect(await settle(send(fc, { type: "fill", tabId: 7, jobId: "job-1" }))).toMatchObject({ note: "No empty fields found on this page." });
    expect(banners(fc)).toEqual([["No empty fields found on this page.", ""]]);
  });

  it("reports an error, shows it on the page and saves it for the popup", async () => {
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    fakeApp({ "POST /api/apply/answers": () => new Response(JSON.stringify({ error: "Add your CV first." }), { status: 400 }) });
    const send = startWorker();
    expect(await settle(send(fc, { type: "fill", tabId: 7, jobId: "job-1" }))).toEqual({ error: "Add your CV first." });
    expect(banners(fc).at(-1)).toEqual(["Add your CV first.", "bad"]);
    expect(fc.session.get("report:7")).toMatchObject({ status: "error", error: "Add your CV first." });
  });

  it("tells you when JobPilot is not running", async () => {
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const send = startWorker();
    expect(await settle(send(fc, { type: "fill", tabId: 7, jobId: "job-1" }))).toEqual({ error: "JobPilot is not running. Start it with npm start." });
  });

  it("gives up when the answers never arrive", async () => {
    const fc = fakeChrome({ frames: formFrames(fillResultsFor) });
    fakeApp({ "POST /api/apply/answers": () => ({ ticket: "t-2" }), "GET /api/apply/answers": () => ({ pending: true }) });
    const send = startWorker();
    expect(await settle(send(fc, { type: "fill", tabId: 7, jobId: "job-1" }), 200_000)).toEqual({ error: "Writing the answers took too long. Press Fill again." });
  });
});

describe("background: which job a tab is for", () => {
  it("prefers a saved job matching the page, then the tab's own job, then the last one opened", async () => {
    const fc = fakeChrome();
    let ctx: Record<string, unknown> = { matchedBy: "url", job: { id: "job-url" } };
    fakeApp({ "GET /api/apply/context": () => ctx });
    const send = startWorker();
    expect(await settle(send(fc, { type: "tabJob", tabId: 7, url: "https://jobs.example/1" }))).toEqual({ id: "job-url", how: "url" });
    ctx = { matchedBy: "recent", job: { id: "job-recent" } };
    expect(await settle(send(fc, { type: "tabJob", tabId: 7, url: "u" }))).toEqual({ id: "job-url", how: "tab" });
    fc.session.clear();
    expect(await settle(send(fc, { type: "tabJob", tabId: 7, url: "u" }))).toEqual({ id: "job-recent", how: "opened" });
    fc.session.clear();
    ctx = {};
    expect(await settle(send(fc, { type: "tabJob", tabId: 7, url: "u" }))).toEqual({ id: null, how: null });
  });

  it("links tabs to jobs from the address mark, the opener tab and the page script", async () => {
    const fc = fakeChrome();
    const send = startWorker();
    fc.listeners.updated[0](9, { url: "https://jobs.example/x#jobpilot-job=job%2F9" });
    await settle(Promise.resolve());
    expect(fc.session.get("job:9")).toBe("job/9");
    fc.listeners.created[0]({ id: 10, openerTabId: 9 });
    fc.listeners.created[0]({ id: 11 });
    await settle(Promise.resolve());
    expect(fc.session.get("job:10")).toBe("job/9");
    expect(fc.session.has("job:11")).toBe(false);
    expect(await settle(send(fc, { type: "taggedJob", jobId: "job-12" }, { tab: { id: 12 } }))).toEqual({ ok: true });
    expect(await settle(send(fc, { type: "setTabJob", tabId: 13, jobId: "" }))).toEqual({ ok: true });
    expect(fc.session.get("job:12")).toBe("job-12");
    expect(fc.session.get("job:13")).toBeNull();
    fc.session.set("report:9", {});
    fc.listeners.removed[0](9);
    await settle(Promise.resolve());
    expect([fc.session.has("job:9"), fc.session.has("report:9")]).toEqual([false, false]);
    expect(await settle(send(fc, { type: "unknown" }))).toBeUndefined();
  });

  it("suggests answers and moves the tab to the job JobPilot matched", async () => {
    const fc = fakeChrome();
    const app = fakeApp({
      "GET /api/apply/context": () => ({}),
      "POST /api/apply/suggest": () => ({ jobId: "job-s", answers: [{ id: "jp1", value: "Alex" }] }),
    });
    const send = startWorker();
    const reply = await settle(send(fc, { type: "suggest", fields: [{ id: "jp1" }] }, { tab: { id: 7, url: "https://jobs.example/apply/1" } }));
    expect(reply).toEqual({ answers: [{ id: "jp1", value: "Alex" }] });
    expect(app.seen.at(-1)).toMatchObject({ body: { url: "https://jobs.example/apply/1", jobId: null } });
    expect(fc.session.get("job:7")).toBe("job-s");
  });

  it("asks the AI for one field with the page as the job", async () => {
    const fc = fakeChrome({ frames: (inj) => (inj.func ? [{ frameId: 0, result: inj.func() }] : []) });
    let polls = 0;
    const app = fakeApp({
      "GET /api/apply/context": () => ({}),
      "POST /api/apply/answers": () => ({ ticket: "t-3" }),
      "GET /api/apply/answers": () => (++polls < 1 ? {} : { answers: [{ id: "jp1", value: "Yes" }] }),
    });
    const send = startWorker();
    const reply = await settle(send(fc, { type: "askAi", url: "https://jobs.example/q", fields: [{ id: "jp1" }] }, { tab: { id: 7 } }));
    expect(reply).toEqual({ answers: [{ id: "jp1", value: "Yes" }] });
    expect(app.seen.find((r) => r.method === "POST")?.body).toMatchObject({ forceAi: true, jobId: null });
  });
});

describe("background: learning from the page", () => {
  it("saves answers, keeps the newest per question and records an error", async () => {
    const fc = fakeChrome({ frames: (inj) => (inj.func ? [{ frameId: 0, result: inj.func() }] : []) });
    fc.session.set("report:7", { jobId: "job-1", learned: [{ question: "City", answer: "Old", at: 1 }, { question: "Notice", answer: "2 weeks", at: 1 }] });
    let fail = false;
    const app = fakeApp({
      "POST /api/apply/learned": () =>
        fail ? new Response(JSON.stringify({ error: "Database is busy." }), { status: 503 }) : { saved: [{ question: "City", answer: "Springfield" }] },
    });
    const send = startWorker();
    expect(await settle(send(fc, { type: "learn", items: [{ label: "City", value: "Springfield" }] }, { tab: { id: 7 } }))).toEqual({
      saved: [{ question: "City", answer: "Springfield" }],
    });
    expect(app.seen[0].body).toEqual({ jobId: "job-1", page: null, items: [{ label: "City", value: "Springfield" }] });
    expect(fc.session.get("report:7")).toMatchSnapshot("report after learning");
    fail = true;
    expect(await settle(send(fc, { type: "learn", tabId: 7, items: [] }))).toEqual({ error: "Database is busy." });
    expect(fc.session.get("report:7")).toMatchObject({ learnError: "Database is busy." });
    expect(await settle(send(fc, { type: "learn", items: "nope" }, { tab: { id: 7 } }))).toBeUndefined();
  });
});
