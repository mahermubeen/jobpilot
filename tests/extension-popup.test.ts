// @vitest-environment happy-dom
//
// Characterisation tests for the extension popup: the job picker, what it shows
// for each state of the last fill, and the buttons that act on the page.
import { describe, expect, it, vi } from "vitest";
import { fakeApp, fakeChrome, source, installFakeClock } from "./helpers/extension";

installFakeClock();


const POPUP = source("popup.html");
const popupBody = POPUP.slice(POPUP.indexOf("<body>") + 6, POPUP.indexOf("<script src"));

/** Opens the popup for a tab and waits for it to connect. */
async function openPopup() {
  document.body.innerHTML = popupBody;
  new Function(source("popup.js"))();
  await vi.advanceTimersByTimeAsync(500);
}
const $ = (id: string) => document.getElementById(id) as HTMLElement & HTMLInputElement & HTMLSelectElement;
const reportText = () =>
  [...$("report").children].map((c) => `${c.tagName.toLowerCase()}.${c.className}: ${[...c.childNodes].map((n) => (n as HTMLElement).className ? `[${(n as HTMLElement).className}] ${n.textContent}` : n.textContent).join(" | ")}`);

const CONTEXT = {
  profileReady: true,
  job: { id: "job-recent", company: "Globex", role: "Engineer" },
  jobs: [{ id: "job-1", company: "Acme Widgets", role: "Engineer" }],
};

describe("popup", () => {
  it("lists saved jobs and picks the one the page matches", async () => {
    const fc = fakeChrome({ frames: () => [{ frameId: 0, result: { on: false, mode: "off", fields: 3, inWindow: false } }] });
    fc.chrome.runtime.sendMessage.mockImplementation(async (msg: { type: string }) => (msg.type === "tabJob" ? { id: "job-1", how: "tab" } : null));
    const app = fakeApp({ "GET /api/apply/context": () => ({ ...CONTEXT, picked: { id: "job-1", company: "Acme Widgets", role: "Engineer" } }) });
    await openPopup();
    expect(app.seen[0].path).toBe("/api/apply/context?url=https%3A%2F%2Fjobs.example%2Fapply%2F1%23top&id=job-1");
    expect([...$("job").options].map((o) => [o.value, o.textContent])).toMatchSnapshot("job list");
    expect([$("job").value, $("fill").disabled, $("addJob").hidden, $("status").textContent]).toEqual(["job-1", false, true, "The job this tab was opened for."]);
    expect($("watching").textContent).toBe("Suggestions are off. Fill this page still works.");
  });

  it("offers to add the page as a job when it is not a saved one", async () => {
    const fc = fakeChrome();
    fc.chrome.runtime.sendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === "tabJob") return { id: null, how: null };
      if (msg.type === "readPage") return { company: "Initech", role: "QA Engineer", description: "Test things." };
      return { ok: true };
    });
    let existing = false;
    const app = fakeApp({
      "GET /api/apply/context": () => ({ ...CONTEXT, job: null }),
      "POST /api/jobs": () => ({ id: "job-new", existing }),
    });
    await openPopup();
    expect([$("job").value, $("addJob").hidden]).toEqual(["", false]);
    expect($("status").textContent).toMatch(/^Not one of your saved jobs/);
    $("addJob").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(app.seen.find((r) => r.method === "POST")?.body).toMatchSnapshot("job added from the page");
    expect($("status").textContent).toBe("Added “Initech · QA Engineer” to JobPilot. Fix the company or role there if they look wrong.");
    existing = true;
    $("addJob").click();
    await vi.advanceTimersByTimeAsync(10);
    expect($("status").textContent).toBe("This job is already in JobPilot, so nothing was added. It's picked above.");
  });

  it("asks for a CV first, and says when JobPilot is not running", async () => {
    fakeChrome();
    fakeApp({ "GET /api/apply/context": () => ({ ...CONTEXT, profileReady: false }) });
    await openPopup();
    expect([$("status").textContent, $("status").className, $("fill").disabled]).toEqual(["Add your CV in JobPilot Settings first.", "bad", true]);
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    fakeChrome();
    await openPopup();
    expect($("status").textContent).toBe("JobPilot is not running. Start it with npm start.");
  });

  it("shows each state of the last fill", async () => {
    const fc = fakeChrome();
    fakeApp({ "GET /api/apply/context": () => CONTEXT });
    await openPopup();
    const show = async (report: Record<string, unknown>) => {
      await fc.chrome.storage.session.set({ "report:7": report });
      return [$("status").textContent, $("status").className, $("fill").disabled, $("learn").hidden];
    };
    expect(await show({ status: "running", at: Date.now() })).toMatchSnapshot("running");
    expect(await show({ status: "error", at: Date.now() - 90_000, error: "Add your CV first." })).toMatchSnapshot("error");
    expect(await show({ status: "done", at: Date.now() - 7_200_000, note: "No empty fields found on this page." })).toMatchSnapshot("note");
    const done = {
      status: "done",
      at: Date.now() - 30_000,
      url: "https://jobs.example/apply/0",
      job: "Acme Widgets · Engineer",
      stats: { aiCalls: 2, inTokens: 12400, outTokens: 312, calls: [{ ai: "Claude", model: "m", purpose: "answers", inTokens: 100, outTokens: 20, ms: 1500 }] },
      learned: [{ question: "City", answer: ["Springfield", "OR"] }, null],
      learnError: "Database is busy.",
      results: [
        { label: "First name", status: "filled", source: "profile", value: "Alex" },
        { label: "Why this job?", status: "filled", source: "ai", value: "I like it." },
        { label: "Years with React", status: "filled", source: "bank", value: "5" },
        { label: "City", status: "check", source: "bank", value: "Springfield" },
        { label: "Portfolio", status: "blank", required: true, source: "none", value: "" },
        { label: "", status: "blank", source: "none", value: "" },
        { label: "Marketing emails", status: "skipped", source: "bank", rule: "marketing-optin", value: "" },
        { label: "Referrer", status: "skipped", source: "bank", rule: "", value: "" },
        { label: "Notice", status: "filled", source: "learned", value: "2 weeks" },
        { label: "Visa", status: "filled", source: "saved", value: "No" },
        { label: "Phone", status: "filled", source: "none", value: "+1 555 0100" },
      ],
    };
    expect(await show(done)).toMatchSnapshot("done");
    expect(reportText()).toMatchSnapshot("done report");
    $("report").querySelector<HTMLAnchorElement>(".learned:not(.bad) a")!.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(fc.calls.created).toEqual([{ url: "http://127.0.0.1:3000/settings?tab=answers" }]);
    expect(await show({ ...done, stats: null, learned: [], learnError: "", results: done.results.slice(0, 1) })).toMatchSnapshot("no AI");
    expect(reportText()).toMatchSnapshot("no AI report");
  });

  it("fills the page, saves your answers and switches suggestions", async () => {
    let watching = { on: false, mode: "off", fields: 0, inWindow: false };
    const fc = fakeChrome({
      frames: (inj) => {
        const fn = String(inj.func);
        if (fn.includes(".flush()")) return [{ frameId: 0, result: 2 }, { frameId: 3, result: 1 }];
        if (fn.includes(".watching()")) return [{ frameId: 0, result: watching }, { frameId: 3, result: null }];
        return [];
      },
    });
    let fillReply: unknown = { results: [] };
    fc.chrome.runtime.sendMessage.mockImplementation(async (msg: { type: string }) => { fc.calls.sent.push(msg); return msg.type === "fill" ? fillReply : null; });
    fakeApp({ "GET /api/apply/context": () => CONTEXT });
    await openPopup();
    $("cv").checked = false;
    $("fill").click();
    await vi.advanceTimersByTimeAsync(10);
    expect(fc.calls.sent.find((m) => (m as { type: string }).type === "fill")).toEqual({
      type: "fill", tabId: 7, jobId: "job-recent", jobLabel: "Globex · Engineer", attachCv: false,
    });
    fillReply = { error: "Add your CV first." };
    $("fill").click();
    await vi.advanceTimersByTimeAsync(10);
    expect($("status").textContent).toBe("Add your CV first.");
    fillReply = undefined;
    $("fill").click();
    await vi.advanceTimersByTimeAsync(10);
    expect($("status").textContent).toBe("The extension did not answer. Reload it and try again.");

    $("learn").click();
    await vi.advanceTimersByTimeAsync(10);
    expect($("status").textContent).toBe("Saving 3 answers you gave…");

    watching = { on: true, mode: "page", fields: 4, inWindow: true };
    $("modePage").click();
    await vi.advanceTimersByTimeAsync(400);
    expect(fc.calls.injections.some((i) => i.files)).toBe(true);
    expect([$("modePage").getAttribute("aria-checked"), $("watching").textContent]).toMatchSnapshot("this page");
    $("modeAll").click();
    await vi.advanceTimersByTimeAsync(400);
    expect([fc.local.get("suggest"), $("modeAll").getAttribute("aria-checked"), $("watching").textContent]).toMatchSnapshot("everywhere");
    watching = null as never;
    $("modeOff").click();
    await vi.advanceTimersByTimeAsync(400);
    expect([fc.local.get("suggest"), $("watching").textContent]).toMatchSnapshot("off");

    $("prefAuto").checked = true;
    $("prefAuto").dispatchEvent(new Event("change"));
    $("port").value = "4000";
    $("port").dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(10);
    expect([fc.local.get("autoFill"), fc.local.get("port")]).toEqual([true, 4000]);
  });

  it("ties a picked job to the tab", async () => {
    const fc = fakeChrome();
    fakeApp({ "GET /api/apply/context": () => CONTEXT });
    await openPopup();
    $("job").value = "job-1";
    $("job").dispatchEvent(new Event("change"));
    await vi.advanceTimersByTimeAsync(10);
    expect(fc.calls.sent.at(-1)).toEqual({ type: "setTabJob", tabId: 7, jobId: "job-1" });
    expect([$("addJob").hidden, $("status").textContent]).toEqual([true, "This tab now uses the job you picked."]);
  });

  it("sends the form's layout without anything typed into it", async () => {
    fakeChrome({ frames: (inj) => (inj.func ? [{ frameId: 0, result: inj.func() }] : []) });
    const app = fakeApp({ "GET /api/apply/context": () => CONTEXT, "POST /api/apply/debug": () => ({ file: "data/debug/form.html" }) });
    await openPopup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog"><style>.x{}</style><script>bad()</script><svg><path d="M0"/></svg><input type="hidden" value="tok"><input name="n" value="Alex"><textarea>secret</textarea></div>`,
    );
    $("layout").click();
    await vi.advanceTimersByTimeAsync(10);
    expect((app.seen.at(-1)?.body as { html: string }).html).toMatchSnapshot("layout sent");
    expect($("status").textContent).toBe("Saved the layout to data/debug/form.html. Tell Claude which page and what went wrong.");
  });
});
