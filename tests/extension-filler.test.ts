// @vitest-environment happy-dom
//
// Characterisation tests for the browser extension's form filler: what it reads
// from a form, what it writes back, which of your own answers it sends to
// JobPilot, and the suggestion chips and list it shows. The scripts are loaded
// the way Chrome loads them: every file in manifest.json's content_scripts, in order.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Field = { id: string; label: string; type: string; options?: string[]; required?: boolean; maxLength?: number };
type Answer = { id: string; value: unknown; source?: string; rule?: string; alternatives?: { value: unknown; source: string }[] };
type Filler = {
  collect: (opts?: { keep?: boolean }) => { fields: Field[]; wantsCv: boolean };
  fill: (answers: Answer[], cv: { name: string; base64: string } | null) => Promise<Record<string, unknown>[]>;
  flush: () => number;
  banner: (message: string, tone?: string) => void;
  suggestNew: (fresh?: boolean) => Promise<void>;
  watching: () => Record<string, unknown>;
  setPage: (on: boolean) => Record<string, unknown>;
};
type Msg = { type: string; fields?: Field[]; items?: { label: string; value: unknown }[] };

const EXT = path.resolve(import.meta.dirname, "../extension");
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")) as { content_scripts: { js: string[] }[] };
const FORM = fs.readFileSync(path.join(EXT, "test-form.html"), "utf8");
const formBody = FORM.slice(FORM.indexOf("<body>") + 6, FORM.indexOf("</body>"));

// What the fake extension background answers, per message type.
const replies: { suggest: Answer[]; askAi: Answer[] | { error: string } } = { suggest: [], askAi: [] };
const sent: Msg[] = [];
const sendMessage = vi.fn(async (msg: Msg) => {
  sent.push(structuredClone(msg));
  if (msg.type === "suggest") return { answers: replies.suggest };
  if (msg.type === "askAi") return Array.isArray(replies.askAi) ? { answers: replies.askAi } : replies.askAi;
  if (msg.type === "learn") return { saved: (msg.items ?? []).map((i) => ({ question: i.label, answer: i.value })) };
  return {};
});

let jp: Filler;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"] });
  // happy-dom does no layout: treat every element as on screen.
  Element.prototype.getClientRects = function () {
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  };
  const g = globalThis as Record<string, unknown>;
  g.chrome = {
    runtime: { id: "test-extension", sendMessage },
    storage: { local: { get: async (d: object) => ({ ...d }) }, onChanged: { addListener: () => {} } },
  };
  if (!g.CSS) g.CSS = { escape: (s: string) => s.replace(/["\\]/g, "\\$&") };
  for (const file of manifest.content_scripts[0].js) {
    new Function(fs.readFileSync(path.join(EXT, file), "utf8"))();
  }
  await vi.advanceTimersByTimeAsync(0);
  jp = (window as unknown as { __jobpilot: Filler }).__jobpilot;
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  sent.length = 0;
  replies.suggest = [];
  replies.askAi = [];
});

const load = (html: string) => {
  document.body.innerHTML = html;
  // happy-dom starts a <select> on the wrong option; pick what a browser picks (the `selected` one, else the first).
  for (const sel of document.querySelectorAll("select")) {
    sel.selectedIndex = Math.max(0, [...sel.options].findIndex((o) => o.hasAttribute("selected")));
  }
};
/** Every form control's state, for comparing what a fill changed. */
const formState = () =>
  [...document.querySelectorAll("input, select, textarea")].map((el) => {
    const i = el as HTMLInputElement;
    const box = i.type === "radio" || i.type === "checkbox" ? i.closest("label") ?? i.parentElement ?? i : i;
    return `${i.name || i.id}:${i.type === "radio" || i.type === "checkbox" ? i.checked : i.value}:${(box as HTMLElement).style.outline}`;
  });
const byLabel = (fields: Field[], re: RegExp) => {
  const f = fields.find((x) => re.test(x.label));
  if (!f) throw new Error(`no field like ${re}`);
  return f;
};
/** Text in the suggestion overlay (chips and the list), which lives in a shadow root. */
const overlayText = () => {
  const host = document.getElementById("jobpilot-suggestions");
  return host?.shadowRoot ? [...host.shadowRoot.children].filter((c) => c.tagName !== "STYLE").map((c) => `${c.className}: ${c.textContent}`) : [];
};
/** Runs a fill to the end, moving fake time on so type-ahead waits finish. */
const fillAll = async (answers: Answer[], cv: { name: string; base64: string } | null = null) => {
  const done = jp.fill(answers, cv);
  await vi.advanceTimersByTimeAsync(3000);
  return done;
};

describe("reading a form", () => {
  it("reads every field type on the test form", () => {
    load(formBody);
    expect(jp.collect()).toMatchSnapshot();
  });

  it("reads only the fields inside an open dialog", () => {
    load(`
      <header><input aria-label="Search jobs"></header>
      <label>Newsletter email <input name="news" type="email"></label>
      <div role="dialog">
        <label>Full name <input name="full" required></label>
        <label>Notice period (required) <select name="notice"><option value="">Pick</option><option value="1">2 weeks</option><option value="2">1 month</option></select></label>
      </div>`);
    expect(jp.collect()).toMatchSnapshot();
    expect(jp.watching()).toMatchObject({ inWindow: true });
  });

  it("finds an overlay window by its fixed position and prefers the one with a Next button", () => {
    load(`
      <div style="position: fixed"><label>Chat message <input name="chat"></label></div>
      <div style="position: fixed"><label>Years with Node.js <input name="node" type="number"></label><label>Portfolio <input name="folio" type="url"></label><button>Next</button></div>`);
    expect(jp.collect().fields.map((f) => f.label)).toEqual(["Years with Node.js", "Portfolio"]);
  });

  it("reads fields inside an open shadow root and skips filled ones", () => {
    load(`<div id="host"></div><label>Prefilled <input name="pre" value="kept"></label>`);
    const shadow = document.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<label>Shadow city <input name="shadowCity"></label>`;
    expect(jp.collect()).toMatchSnapshot();
  });

  it("marks required questions from a star, a required class or aria-required", () => {
    load(`
      <div class="q"><span>Start date</span><span class="field-required">*</span><input name="start" type="date"></div>
      <div class="q"><span class="label">Preferred name</span><span class="is-required">needed</span><input name="pref"></div>
      <div role="radiogroup" aria-required="true" aria-label="Open to contract work?">
        <label><input type="radio" name="contract" value="y">Yes</label><label><input type="radio" name="contract" value="n">No</label>
      </div>
      <label>Hobbies <textarea name="hobbies" maxlength="200"></textarea></label>`);
    expect(jp.collect().fields.map((f) => [f.label, f.type, !!f.required, f.maxLength ?? null])).toMatchSnapshot();
  });
});

describe("filling a form", () => {
  it("writes answers into every field type and reports each one", async () => {
    load(formBody);
    const { fields } = jp.collect();
    const answer = (re: RegExp, value: unknown, source = "bank") => ({ id: byLabel(fields, re).id, value, source });
    const answers = [
      answer(/^First name/, "Alex", "profile"),
      answer(/^Email/, "alex@example.com", "profile"),
      answer(/^Phone/, "+1 555 0100", "profile"),
      answer(/React\?$/, 5),
      answer(/salary/, "100000"),
      answer(/^Country/, "United States"),
      answer(/legally authorised/, "Yes"),
      answer(/in production\?$/, ["Node.js", "Rust"]),
      answer(/privacy policy/, "yes"),
      answer(/Why do you want/, "I like the product.", "ai"),
      answer(/^City/, "Springfield"),
      answer(/Expo/, "1–2 years in production apps"),
      answer(/React Native\?$/, "5–7 years — I have solid experience."),
      answer(/only you can answer/, null, "none"),
      answer(/Resume/, null, "cv"),
      { id: "jp-missing", value: "x" },
    ];
    const result = await fillAll(answers, { name: "cv.pdf", base64: Buffer.from("%PDF-1.4").toString("base64") });
    expect(result).toMatchSnapshot();
    expect(formState()).toMatchSnapshot();
  });

  it("picks the matching suggestion of a type-ahead box", async () => {
    load(`
      <label>Current city <input name="city" role="combobox" aria-controls="cities"></label>
      <ul id="cities" role="listbox"><li role="option">Springfield, Oregon</li><li role="option">Springfield</li><li role="option">Shelbyville</li></ul>`);
    const clicked: string[] = [];
    document.getElementById("cities")!.addEventListener("click", (e) => clicked.push((e.target as HTMLElement).textContent ?? ""));
    const [f] = jp.collect().fields;
    const [r] = await fillAll([{ id: f.id, value: "Springfield", source: "bank" }]);
    expect(r).toMatchObject({ status: "filled", value: "Springfield" });
    expect(clicked).toEqual(["Springfield"]);
  });

  it("flags a type-ahead answer for checking when no suggestion fits", async () => {
    load(`
      <label>Current city <input name="city" role="combobox"></label>
      <ul role="listbox"><li role="option">Shelbyville</li></ul>`);
    const [f] = jp.collect().fields;
    const [r] = await fillAll([{ id: f.id, value: "Springfield", source: "bank" }]);
    expect(r).toMatchObject({ status: "check" });
  });
});

describe("learning your own answers", () => {
  it("sends answers you typed or changed after a fill, once", async () => {
    load(formBody);
    const { fields } = jp.collect();
    await fillAll([{ id: byLabel(fields, /^First name/).id, value: "Alex", source: "profile" }]);
    const mine = document.querySelector<HTMLInputElement>('input[name="mine"]')!;
    mine.value = "Only I know this";
    document.querySelector<HTMLInputElement>('input[name="auth"][value="0"]')!.checked = true;
    document.querySelector<HTMLInputElement>('input[name="first"]')!.value = "Alexandra";
    document.querySelector<HTMLSelectElement>('select[name="country"]')!.selectedIndex = 1;
    // The first name box still has focus from the fill: you may still be typing, so it waits.
    expect(jp.flush()).toBe(3);
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector<HTMLInputElement>('input[name="first"]')!.blur();
    expect(jp.flush()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((m) => m.type === "learn")).toMatchSnapshot();
    expect(document.documentElement.lastElementChild?.textContent).toContain("Saved to JobPilot:");
    expect(jp.flush()).toBe(0);
  });

  it("keeps a watched field's starting value and sends only a change to it", async () => {
    load(`<label>Prefilled <input name="pre" value="kept"></label><label>Level <select name="lvl"><option value="">-</option><option value="a">Junior</option><option value="b" selected>Senior</option></select></label>`);
    expect(jp.collect().fields).toEqual([]);
    expect(jp.flush()).toBe(0);
    document.querySelector<HTMLSelectElement>('select[name="lvl"]')!.selectedIndex = 1;
    expect(jp.flush()).toBe(1);
    expect(sent.at(-1)).toMatchSnapshot();
  });
});

describe("suggestions", () => {
  it("shows a chip for a known option answer and a list for a text box", async () => {
    load(`
      <label>Preferred name <input name="pref"></label>
      <fieldset><legend>Open to relocation?</legend><label><input type="radio" name="reloc" value="y">Yes</label><label><input type="radio" name="reloc" value="n">No</label></fieldset>
      <fieldset><legend>Need a visa?</legend><label><input type="radio" name="visa" value="y">Yes</label><label><input type="radio" name="visa" value="n">No</label></fieldset>`);
    const preview = jp.collect().fields;
    replies.suggest = [
      { id: "", value: "Alex", source: "profile", alternatives: [{ value: "Al", source: "saved" }] },
      { id: "", value: "No", source: "saved" },
    ];
    // The ids are given out again when suggestions read the form afresh.
    sendMessage.mockImplementationOnce(async (msg: Msg) => {
      sent.push(structuredClone(msg));
      const ids = (msg.fields ?? []).map((f) => f.id);
      return { answers: [{ ...replies.suggest[0], id: ids[0] }, { ...replies.suggest[1], id: ids[1] }, { id: ids[2], value: null }] };
    });
    jp.setPage(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(preview.map((f) => f.label)).toEqual(["Preferred name", "Open to relocation?", "Need a visa?"]);
    expect(sent.find((m) => m.type === "suggest")?.fields?.map((f) => [f.label, f.type])).toMatchSnapshot();
    expect(overlayText()).toMatchSnapshot("chip for the radio question");

    const pref = document.querySelector<HTMLInputElement>('input[name="pref"]')!;
    pref.dispatchEvent(new FocusEvent("focus"));
    expect(overlayText()).toMatchSnapshot("list for the text box");

    pref.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    pref.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(pref.value).toBe("Al");

    const chip = document.getElementById("jobpilot-suggestions")!.shadowRoot!.querySelector<HTMLElement>(".chip")!;
    chip.click();
    await vi.advanceTimersByTimeAsync(10);
    expect(document.querySelector<HTMLInputElement>('input[name="reloc"][value="n"]')!.checked).toBe(true);
    expect(overlayText()).toMatchSnapshot("chip after filling");
    await vi.advanceTimersByTimeAsync(2000);
    expect(overlayText()).toEqual([]);
    expect(jp.watching()).toMatchObject({ on: true, mode: "page" });
    jp.setPage(false);
  });

  it("asks the AI from the list, and shows its error when it has none", async () => {
    load(`<label>Describe your best project <textarea name="best"></textarea></label><label>Favourite tool <input name="tool"></label>`);
    sendMessage.mockImplementationOnce(async (msg: Msg) => {
      sent.push(structuredClone(msg));
      return { answers: (msg.fields ?? []).map((f) => ({ id: f.id, value: null })) };
    });
    jp.setPage(true);
    await vi.advanceTimersByTimeAsync(10);
    const ids = sent.find((m) => m.type === "suggest")!.fields!.map((f) => f.id);

    const best = document.querySelector<HTMLTextAreaElement>('textarea[name="best"]')!;
    replies.askAi = [{ id: ids[0], value: "A search engine for recipes.", source: "ai" }];
    best.dispatchEvent(new FocusEvent("focus"));
    best.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(overlayText()).toMatchSnapshot("asking");
    await vi.advanceTimersByTimeAsync(10);
    expect(overlayText()).toMatchSnapshot("AI answer offered");
    best.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(best.value).toBe("A search engine for recipes.");

    const tool = document.querySelector<HTMLInputElement>('input[name="tool"]')!;
    replies.askAi = { error: "No AI is set up." };
    tool.dispatchEvent(new FocusEvent("focus"));
    tool.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.advanceTimersByTimeAsync(10);
    expect(overlayText()).toMatchSnapshot("AI error");
    tool.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(overlayText()).toEqual([]);
    jp.setPage(false);
  });

  it("asks the AI from a chip when every suggestion is shown", async () => {
    load(`<fieldset><legend>Willing to travel?</legend><label><input type="radio" name="t" value="y">Yes</label><label><input type="radio" name="t" value="n">No</label></fieldset>`);
    sendMessage.mockImplementationOnce(async (msg: Msg) => {
      sent.push(structuredClone(msg));
      return { answers: [{ id: msg.fields![0].id, value: "Yes", source: "learned" }] };
    });
    jp.setPage(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(overlayText()).toMatchSnapshot("learned chip");
    const x = document.getElementById("jobpilot-suggestions")!.shadowRoot!.querySelector<HTMLElement>("button.x")!;
    x.click();
    expect(overlayText()).toEqual([]);
    jp.setPage(false);
  });
});

describe("loading", () => {
  it("does nothing when the extension injects the page scripts again", () => {
    load(`<label>Preferred name <input name="pref"></label>`);
    const before = jp.collect().fields;
    const lib = (window as unknown as { __jobpilotLib: object }).__jobpilotLib;
    for (const file of manifest.content_scripts[0].js) new Function(fs.readFileSync(path.join(EXT, file), "utf8"))();
    expect((window as unknown as { __jobpilot: Filler }).__jobpilot).toBe(jp);
    expect((window as unknown as { __jobpilotLib: object }).__jobpilotLib).toBe(lib);
    expect(jp.watching()).toMatchObject({ fields: before.length });
  });
});

describe("the banner", () => {
  it("shows one banner and recolours it", () => {
    jp.banner("Filling 3 fields");
    jp.banner("Done", "good");
    const boxes = document.querySelectorAll("#jobpilot-banner");
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLElement).textContent).toBe("JobPilot\nDone");
    expect((boxes[0] as HTMLElement).style.background).toBeTruthy();
  });
});
