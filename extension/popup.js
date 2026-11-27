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

// The page scripts, in the order manifest.json loads them on job sites.
const FILLER_FILES = chrome.runtime.getManifest().content_scripts[0].js;

const getPort = async () => (await chrome.storage.local.get({ port: 3000 })).port;

// The background decides which job a tab is for, so the popup, Fill and the
// suggestions under fields always agree.
async function loadContext(port) {
  const mine = await chrome.runtime.sendMessage({ type: "tabJob", tabId: tab.id, url: tab.url || "" }).catch(() => null);
  const mineId = mine && mine.id;
  const q = `url=${encodeURIComponent(tab?.url || "")}${mineId ? `&id=${encodeURIComponent(mineId)}` : ""}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/apply/context?${q}`);
  const ctx = await res.json();
  if (!res.ok) throw new Error(ctx.error || "JobPilot answered with an error.");
  return { mine, ctx, chosen: ctx.picked || (mineId ? null : ctx.job) };
}

/** The job list: "not a saved job" first, then the chosen job if it is not listed, then the rest. */
function fillJobList(ctx, chosen) {
  const listed = new Set(ctx.jobs.map((j) => j.id));
  const jobs = chosen && !listed.has(chosen.id) ? [chosen, ...ctx.jobs] : ctx.jobs;
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
}

function showContext({ mine, ctx, chosen }) {
  if (!ctx.profileReady) return status("Add your CV in JobPilot Settings first.", true);
  $("fill").disabled = false;
  if (!chosen) {
    $("addJob").hidden = false;
    return status(NO_JOB);
  }
  status(HOW[mine && mine.how] || HOW.url);
}

const errorText = (err) => (err instanceof TypeError ? "JobPilot is not running. Start it with npm start." : String(err.message || err));

async function connect() {
  const port = await getPort();
  $("port").value = port;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("fill").disabled = true;
  $("addJob").hidden = true;
  $("job").replaceChildren();
  try {
    const found = await loadContext(port);
    fillJobList(found.ctx, found.chosen);
    showContext(found);
  } catch (err) {
    status(errorText(err), true);
  }
}

// Picking a job ties it to this tab, so Fill, suggestions and Ask AI all use it.
$("job").addEventListener("change", async () => {
  const id = $("job").value;
  await chrome.runtime.sendMessage({ type: "setTabJob", tabId: tab.id, jobId: id || null }).catch(() => {});
  $("addJob").hidden = !!id;
  status(id ? "This tab now uses the job you picked." : NO_JOB);
});

/** Saves the job this page shows to JobPilot, read the same way Fill reads a page that is not a saved job. */
async function addPageAsJob() {
  const page = await chrome.runtime.sendMessage({ type: "readPage", tabId: tab.id });
  if (!page || page.error) throw new Error((page && page.error) || "could not read this page");
  const link = (tab.url || "").split("#")[0];
  const r = await fetch(`http://127.0.0.1:${await getPort()}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company: page.company, role: page.role, link, description: page.description, source: "Extension", status: "Found" }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.status);
  return { page, body };
}

// Adds the job on this page to JobPilot from what the page shows, and uses it.
$("addJob").addEventListener("click", async () => {
  try {
    const { page, body } = await addPageAsJob();
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
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (at) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  return s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
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
function groupOf(r) {
  if (r.status === "skipped") return "skipped";
  if (r.status === "check" || (r.status !== "filled" && r.required)) return "required";
  if (r.status !== "filled") return "optional";
  return r.source && r.source !== "none" ? r.source : "profile";
}

/** Each result under its group, grouped once. */
function byGroup(results) {
  const groups = new Map();
  for (const r of results) {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  return groups;
}

// A report that is not a finished fill: say what it is and stop.
function renderState(report) {
  if (report.status === "running") {
    $("fill").disabled = true;
    status("Filling this page… You can close this window; the result will be here when you open it again.");
    return true;
  }
  $("fill").disabled = false;
  if (report.status === "error") {
    status(`Last fill (${ago(report.at)}) failed: ${report.error}`, true);
    return true;
  }
  if (report.note) {
    status(report.note);
    return true;
  }
  return false;
}

function summary(report, results, groups) {
  const count = (g) => (groups.get(g) || []).length;
  const filled = results.filter((r) => r.status === "filled").length;
  const required = count("required");
  const optional = count("optional");
  const elsewhere = tab && report.url && report.url !== tab.url ? "\nFrom the application page you were on before." : "";
  return (
    `Last fill · ${ago(report.at)}${report.job ? ` · ${report.job}` : ""}${elsewhere}\n` +
    `Filled ${filled} of ${results.length - count("skipped")}` +
    (required ? ` · ${required} required left for you (amber)` : " · every required field is filled") +
    (optional ? ` · ${optional} optional left empty` : "") +
    ". Check everything before you submit."
  );
}

function aiBox(st, results) {
  const box = el("div", "ai " + (st.aiCalls ? "used" : "none"));
  const aiFields = results.filter((r) => r.source === "ai" && r.status === "filled").length;
  box.append(
    el("b", "", st.aiCalls
      ? `AI used for ${plural(aiFields, "answer")} · ${plural(st.aiCalls, "call")} · ${fmt(st.inTokens)} tokens in / ${fmt(st.outTokens)} out`
      : "No AI used — every answer came from your CV, facts and record."),
  );
  for (const c of st.calls || []) {
    box.append(el("div", "call", `${c.ai} · ${c.model} · ${c.purpose} · ${fmt(c.inTokens)} → ${fmt(c.outTokens)} tokens · ${(c.ms / 1000).toFixed(1)} s`));
  }
  return box;
}

function learnedBox(learned) {
  const box = el("div", "learned");
  box.append(el("b", "", `Saved to your record (${learned.length}) — next time these fill themselves:`));
  for (const x of learned) box.append(el("div", "call", `${x.question} → ${[].concat(x.answer).join(", ")}`));
  const link = el("a", "", "Open the record in JobPilot");
  link.href = "#";
  link.addEventListener("click", async (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `http://127.0.0.1:${await getPort()}/settings?tab=answers` });
  });
  box.append(link);
  return box;
}

// The short note after a field's question.
function noteFor(r) {
  if (r.status === "check") return "pick it from the list";
  if (r.status === "blank") return r.required ? "no answer found" : "optional";
  if (r.status === "skipped") return r.rule === "marketing-optin" ? "marketing opt-in" : "optional";
  return r.value;
}

function resultRow(r, g) {
  const li = el("li", r.status === "filled" ? "filled" : g.key === "required" ? "" : "skipped");
  if (g.tag) li.append(el("span", "tag " + g.key, g.tag));
  li.append(el("span", "q", r.label || "(unlabelled field)"));
  const note = noteFor(r);
  if (note) li.append(el("span", "a", note));
  return li;
}

function render(report) {
  $("report").replaceChildren();
  if (!report || !report.status) return;
  $("learn").hidden = report.status !== "done";
  if (renderState(report)) return;

  const results = report.results || [];
  const groups = byGroup(results);
  status(summary(report, results, groups));
  $("report").append(aiBox(report.stats || {}, results));
  renderLearned(report);
  renderGroups(groups);
}

// What was saved from your own answers, or why it could not be.
function renderLearned(report) {
  if (report.learnError) $("report").append(el("div", "learned bad", `Could not save your own answers: ${report.learnError}`));
  const learned = (report.learned || []).filter((x) => x && typeof x === "object");
  if (learned.length) $("report").append(learnedBox(learned));
}

function renderGroups(groups) {
  for (const g of GROUPS) {
    const rows = groups.get(g.key) || [];
    if (!rows.length) continue;
    $("report").append(el("h2", "", `${g.title} (${rows.length})`));
    const ul = el("ul");
    for (const r of rows) ul.append(resultRow(r, g));
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
  status(n ? `Saving ${plural(n, "answer")} you gave…` : "Nothing new to save. Fill or change a field on the page first.");
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
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: FILLER_FILES }).catch(() => {});
  }
  await inPage((on) => window.__jobpilot && window.__jobpilot.setPage && window.__jobpilot.setPage(on), [mode === "page"]);
  showMode(mode);
  setTimeout(showWatching, 300);
}
$("modeOff").addEventListener("click", () => setMode("off"));
$("modePage").addEventListener("click", () => setMode("page"));
$("modeAll").addEventListener("click", () => setMode("everywhere"));

function watchingText(mode, seen) {
  if (mode === "off") return "Suggestions are off. Fill this page still works.";
  if (!seen.length) return "JobPilot can't reach this page. Reload it, then choose “This page” again.";
  const fields = seen.reduce((n, x) => n + x.fields, 0);
  const where = seen.some((x) => x.inWindow) ? " in the application window" : "";
  return `Suggestions on ${mode === "page" ? "for this page" : "everywhere"} · ${plural(fields, "form field")} seen${where}.`;
}

// What is switched on for this page, and whether JobPilot can see the form.
async function showWatching() {
  if (!tab) return;
  const runs = await inPage(() => (window.__jobpilot && window.__jobpilot.watching ? window.__jobpilot.watching() : null));
  const seen = runs.map((r) => r.result).filter(Boolean);
  const { suggest } = await chrome.storage.local.get({ suggest: false });
  const mode = suggest ? "everywhere" : seen.some((x) => x.mode === "page") ? "page" : "off";
  showMode(mode);
  $("watching").textContent = watchingText(mode, seen);
}

// Runs in the page: the form's markup, without anything typed into it.
function formLayoutInTab() {
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
}

// A copy of the form's markup without anything typed into it, saved on this computer.
$("layout").addEventListener("click", async () => {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: formLayoutInTab });
    const r = await fetch(`http://127.0.0.1:${await getPort()}/api/apply/debug`, {
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
