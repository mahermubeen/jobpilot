const $ = (id) => document.getElementById(id);
const status = (message, bad) => {
  $("status").textContent = message;
  $("status").className = bad ? "bad" : "";
};

let tab = null;

const HOW = {
  url: "This page matches a saved job.",
  tab: "The job this tab was opened for.",
  opened: "The job you last opened from JobPilot.",
};

const NO_JOB =
  "Not one of your saved jobs. Fill reads the role and company from this page and answers from your CV and record. Pick a saved job above to use its tailored CV.";

async function connect() {
  const { port } = await chrome.storage.local.get({ port: 3000 });
  $("port").value = port;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("fill").disabled = true;
  $("addJob").hidden = true;
  $("job").replaceChildren();
  try {
    // The background decides which job a tab is for, so the popup, Fill and the
    // suggestions under fields always agree.
    const mine = await chrome.runtime.sendMessage({ type: "tabJob", tabId: tab.id, url: tab.url || "" }).catch(() => null);
    const q = `url=${encodeURIComponent(tab?.url || "")}${mine && mine.id ? `&id=${encodeURIComponent(mine.id)}` : ""}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/apply/context?${q}`);
    const ctx = await res.json();
    if (!res.ok) throw new Error(ctx.error || "JobPilot answered with an error.");
    const chosen = ctx.picked || (mine && mine.id ? null : ctx.job);
    const jobs = chosen && !ctx.jobs.some((j) => j.id === chosen.id) ? [chosen, ...ctx.jobs] : ctx.jobs;

    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— not a saved job: use what this page says —";
    $("job").append(none);
    for (const j of jobs) {
      const o = document.createElement("option");
      o.value = j.id;
      o.textContent = `${j.company} · ${j.role}`;
      $("job").append(o);
    }
    $("job").value = chosen ? chosen.id : "";
    if (!ctx.profileReady) return status("Add your CV in JobPilot Settings first.", true);
    $("fill").disabled = false;
    if (!chosen) {
      $("addJob").hidden = false;
      return status(NO_JOB);
    }
    status(HOW[mine && mine.how] || HOW.url);
  } catch (err) {
    status(err instanceof TypeError ? "JobPilot is not running. Start it with npm start." : String(err.message || err), true);
  }
}

// Picking a job ties it to this tab, so Fill, suggestions and Ask AI all use it.
$("job").addEventListener("change", async () => {
  const id = $("job").value;
  await chrome.runtime.sendMessage({ type: "setTabJob", tabId: tab.id, jobId: id || null }).catch(() => {});
  $("addJob").hidden = !!id;
  status(id ? "This tab now uses the job you picked." : NO_JOB);
});

// Adds the job on this page to JobPilot from what the page shows, and uses it.
$("addJob").addEventListener("click", async () => {
  try {
    // Read the same way Fill reads a page that is not a saved job.
    const page = await chrome.runtime.sendMessage({ type: "readPage", tabId: tab.id });
    if (!page || page.error) throw new Error((page && page.error) || "could not read this page");
    const { port } = await chrome.storage.local.get({ port: 3000 });
    const link = (tab.url || "").split("#")[0];
    const r = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: page.company, role: page.role, link, description: page.description, source: "Extension", status: "Found" }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    await chrome.runtime.sendMessage({ type: "setTabJob", tabId: tab.id, jobId: body.id });
    await connect();
    status(
      body.existing
        ? "This job is already in JobPilot, so nothing was added. It's picked above."
        : `Added “${page.company} · ${page.role}” to JobPilot. Fix the company or role there if they look wrong.`,
    );
  } catch (err) {
    status(`Could not add this job: ${err.message || err}`, true);
  }
});

$("port").addEventListener("change", async () => {
  await chrome.storage.local.set({ port: Number($("port").value) || 3000 });
  connect();
});

const fmt = (n) => Number(n || 0).toLocaleString();
const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// Groups in the order you'd want to check them: AI answers first.
const GROUPS = [
  { key: "required", title: "Required — fill these", tag: "" },
  { key: "ai", title: "Written by AI", tag: "AI" },
  { key: "learned", title: "From the record (answered before)", tag: "record" },
  { key: "saved", title: "Your own answers", tag: "yours" },
  { key: "bank", title: "Answer bank (your facts, no AI)", tag: "bank" },
  { key: "profile", title: "From your CV", tag: "CV" },
  { key: "optional", title: "Optional — fine to leave empty", tag: "" },
  { key: "skipped", title: "Left empty on purpose", tag: "" },
];
const groupOf = (r) =>
  r.status === "skipped" ? "skipped"
  : r.status === "check" || (r.status !== "filled" && r.required) ? "required"
  : r.status !== "filled" ? "optional"
  : r.source && r.source !== "none" ? r.source : "profile";

function render(report) {
  $("report").replaceChildren();
  if (!report || !report.status) return;
  $("learn").hidden = report.status !== "done";
  if (report.status === "running") {
    $("fill").disabled = true;
    return status("Filling this page… You can close this window; the result will be here when you open it again.");
  }
  $("fill").disabled = false;
  if (report.status === "error") return status(`Last fill (${ago(report.at)}) failed: ${report.error}`, true);
  if (report.note) return status(report.note);

  const results = report.results || [];
  const st = report.stats || {};
  const filled = results.filter((r) => r.status === "filled").length;
  const required = results.filter((r) => groupOf(r) === "required").length;
  const optional = results.filter((r) => groupOf(r) === "optional").length;
  const elsewhere = tab && report.url && report.url !== tab.url ? "\nFrom the application page you were on before." : "";
  status(
    `Last fill · ${ago(report.at)}${report.job ? ` · ${report.job}` : ""}${elsewhere}\n` +
      `Filled ${filled} of ${results.length - results.filter((r) => r.status === "skipped").length}` +
      (required ? ` · ${required} required left for you (amber)` : " · every required field is filled") +
      (optional ? ` · ${optional} optional left empty` : "") +
      ". Check everything before you submit.",
  );

  const aiBox = el("div", "ai " + (st.aiCalls ? "used" : "none"));
  const aiFields = results.filter((r) => r.source === "ai" && r.status === "filled").length;
  aiBox.append(
    el("b", "", st.aiCalls
      ? `AI used for ${aiFields} answer${aiFields === 1 ? "" : "s"} · ${st.aiCalls} call${st.aiCalls === 1 ? "" : "s"} · ${fmt(st.inTokens)} tokens in / ${fmt(st.outTokens)} out`
      : "No AI used — every answer came from your CV, facts and record."),
  );
  for (const c of st.calls || []) {
    aiBox.append(el("div", "call", `${c.ai} · ${c.model} · ${c.purpose} · ${fmt(c.inTokens)} → ${fmt(c.outTokens)} tokens · ${(c.ms / 1000).toFixed(1)} s`));
  }
  $("report").append(aiBox);

  if (report.learnError) {
    $("report").append(el("div", "learned bad", `Could not save your own answers: ${report.learnError}`));
  }
  const learned = (report.learned || []).filter((x) => x && typeof x === "object");
  if (learned.length) {
    const box = el("div", "learned");
    box.append(el("b", "", `Saved to your record (${learned.length}) — next time these fill themselves:`));
    for (const x of learned) box.append(el("div", "call", `${x.question} → ${[].concat(x.answer).join(", ")}`));
    const link = el("a", "", "Open the record in JobPilot");
    link.href = "#";
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const { port } = await chrome.storage.local.get({ port: 3000 });
      chrome.tabs.create({ url: `http://127.0.0.1:${port}/settings?tab=answers` });
    });
    box.append(link);
    $("report").append(box);
  }

  for (const g of GROUPS) {
    const rows = results.filter((r) => groupOf(r) === g.key);
    if (!rows.length) continue;
    $("report").append(el("h2", "", `${g.title} (${rows.length})`));
    const ul = el("ul");
    for (const r of rows) {
      const li = el("li", r.status === "filled" ? "filled" : g.key === "required" ? "" : "skipped");
      if (g.tag) li.append(el("span", "tag " + g.key, g.tag));
      li.append(el("span", "q", r.label || "(unlabelled field)"));
      const note =
        r.status === "check" ? "pick it from the list"
        : r.status === "blank" && !r.required ? "optional"
        : r.status === "blank" ? "no answer found"
        : r.status === "skipped" ? (r.rule === "marketing-optin" ? "marketing opt-in" : "optional")
        : r.value;
      if (note) li.append(el("span", "a", note));
      ul.append(li);
    }
    $("report").append(ul);
  }
}

async function showSaved() {
  if (!tab) return;
  const key = `report:${tab.id}`;
  const got = await chrome.storage.session.get(key);
  const report = got[key];
  // Shown even after the page moved on (e.g. to the "thanks" page), so you can see what was saved.
  if (report) render(report);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && tab && changes[`report:${tab.id}`]) render(changes[`report:${tab.id}`].newValue);
});

$("fill").addEventListener("click", async () => {
  $("fill").disabled = true;
  $("report").replaceChildren();
  status("Reading the form and writing answers. This can take up to a minute…");
  const job = $("job").selectedOptions[0];
  const reply = await chrome.runtime.sendMessage({
    type: "fill",
    tabId: tab.id,
    jobId: $("job").value,
    jobLabel: job ? job.textContent : "",
    attachCv: $("cv").checked,
  });
  $("fill").disabled = false;
  if (!reply) return status("The extension did not answer. Reload it and try again.", true);
  if (reply.error) return status(reply.error, true);
  await showSaved();
});

// Sends what you typed or picked yourself. Pressing Submit / Next on the page does the same.
$("learn").addEventListener("click", async () => {
  const runs = await chrome.scripting
    .executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (window.__jobpilot ? window.__jobpilot.flush() : 0) })
    .catch(() => []);
  const n = runs.reduce((t, r) => t + (r.result || 0), 0);
  status(n ? `Saving ${n} answer${n === 1 ? "" : "s"} you gave…` : "Nothing new to save. Fill or change a field on the page first.");
});

(async () => {
  const p = await chrome.storage.local.get({ autoFill: false, showAll: false });
  $("prefAuto").checked = p.autoFill;
  $("prefShowAll").checked = p.showAll;
})();
$("prefShowAll").addEventListener("change", (e) => chrome.storage.local.set({ showAll: e.target.checked }));
$("prefAuto").addEventListener("change", (e) => chrome.storage.local.set({ autoFill: e.target.checked }));

// Answer suggestions: Off | This page | Everywhere. Off by default.
const inPage = (func, args = []) =>
  chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func, args }).catch(() => []);

function showMode(mode) {
  for (const [id, m] of [["modeOff", "off"], ["modePage", "page"], ["modeAll", "everywhere"]]) {
    $(id).setAttribute("aria-checked", String(mode === m));
  }
}

async function setMode(mode) {
  await chrome.storage.local.set({ suggest: mode === "everywhere" });
  if (mode === "page") {
    // Company career sites don't run JobPilot by themselves; start it on this page.
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["filler.js"] }).catch(() => {});
  }
  await inPage((on) => window.__jobpilot && window.__jobpilot.setPage && window.__jobpilot.setPage(on), [mode === "page"]);
  showMode(mode);
  setTimeout(showWatching, 300);
}
$("modeOff").addEventListener("click", () => setMode("off"));
$("modePage").addEventListener("click", () => setMode("page"));
$("modeAll").addEventListener("click", () => setMode("everywhere"));

// What is switched on for this page, and whether JobPilot can see the form.
async function showWatching() {
  if (!tab) return;
  const runs = await inPage(() => (window.__jobpilot && window.__jobpilot.watching ? window.__jobpilot.watching() : null));
  const seen = runs.map((r) => r.result).filter(Boolean);
  const { suggest } = await chrome.storage.local.get({ suggest: false });
  const mode = suggest ? "everywhere" : seen.some((x) => x.mode === "page") ? "page" : "off";
  showMode(mode);
  const fields = seen.reduce((n, x) => n + x.fields, 0);
  const where = seen.some((x) => x.inWindow) ? " in the application window" : "";
  $("watching").textContent =
    mode === "off"
      ? "Suggestions are off. Fill this page still works."
      : !seen.length
        ? "JobPilot can't reach this page. Reload it, then choose “This page” again."
        : `Suggestions on ${mode === "page" ? "for this page" : "everywhere"} · ${fields} form field${fields === 1 ? "" : "s"} seen${where}.`;
}

// A copy of the form's markup without anything typed into it, saved on this computer.
$("layout").addEventListener("click", async () => {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const roots = [];
        const collect = (node) => {
          for (const el of node.querySelectorAll("*")) {
            if (!el.shadowRoot) continue;
            roots.push(el.shadowRoot);
            collect(el.shadowRoot);
          }
        };
        collect(document);
        const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].filter((d) => d.querySelector("input, select, textarea"));
        const root = dialogs[dialogs.length - 1] || document.querySelector("main") || document.body;
        // getHTML keeps open shadow roots in place (LinkedIn's Easy Apply lives in one).
        let html = root.getHTML ? root.getHTML({ serializableShadowRoots: true, shadowRoots: roots }) : root.innerHTML;
        if (!root.getHTML) html += roots.map((r) => r.innerHTML).join("\n");
        return html
          .replace(/<script\b[\s\S]*?<\/script>/gi, "")
          .replace(/<style\b[\s\S]*?<\/style>/gi, "")
          .replace(/<svg\b[\s\S]*?<\/svg>/gi, "<svg/>")
          .replace(/<input\b[^>]*type="hidden"[^>]*>/gi, "")
          .replace(/(<input\b[^>]*?)\svalue="[^"]*"/gi, "$1")
          .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1$2");
      },
    });
    const { port } = await chrome.storage.local.get({ port: 3000 });
    const r = await fetch(`http://127.0.0.1:${port}/api/apply/debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, html: res.result }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    status(`Saved the layout to ${body.file}. Tell Claude which page and what went wrong.`);
  } catch (err) {
    status(`Could not save the layout: ${err.message || err}`, true);
  }
});

connect().then(showSaved).then(showWatching);
