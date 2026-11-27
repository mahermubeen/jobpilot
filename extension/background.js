// Orchestrates one "Fill this page" press: read the fields from the tab, ask
// the local JobPilot app for answers, write them back. Runs here rather than
// in the popup so it keeps going when the popup closes.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The page scripts, in the order manifest.json loads them on job sites.
const FILLER_FILES = chrome.runtime.getManifest().content_scripts[0].js;
const errorText = (err) => String((err && err.message) || err);
const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function baseUrl() {
  const { port } = await chrome.storage.local.get({ port: 3000 });
  return `http://127.0.0.1:${port}`;
}

async function call(path, init) {
  let res;
  try {
    res = await fetch((await baseUrl()) + path, init);
  } catch {
    throw new Error("JobPilot is not running. Start it with npm start.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `JobPilot answered ${res.status}.`);
  return body;
}

async function inFrames(tabId, injection) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, ...injection });
  } catch {
    // Some embedded frames cannot be reached; the page itself still can.
    return chrome.scripting.executeScript({ target: { tabId }, ...injection });
  }
}

const banner = (tabId, message, tone) =>
  chrome.scripting
    .executeScript({ target: { tabId }, func: (m, t) => window.__jobpilot && window.__jobpilot.banner(m, t), args: [message, tone || ""] })
    .catch(() => {});

// What the page says about the job, for forms that are not one of your saved
// jobs. Read from the top frame: embedded forms (Tally, Greenhouse) sit in an
// iframe while the job text is on the page around them. It runs in the page,
// so everything it uses is defined inside it.
function pageInfoInTab() {
  const meta = (n) => (document.querySelector(`meta[property="${n}"], meta[name="${n}"]`) || {}).content || "";
  const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const strip = (html) => {
    // DOMParser loads nothing and runs nothing in the markup.
    const marked = String(html || "").replace(/<(br|\/p|\/li|\/div|\/h\d)\b[^>]*>/gi, "\n$&");
    return new DOMParser().parseFromString(marked, "text/html").body.textContent || "";
  };
  // A schema.org JobPosting is the most reliable source when the site has one.
  const findPosting = () => {
    let posting = null;
    const visit = (x) => {
      if (posting || !x || typeof x !== "object") return;
      if (Array.isArray(x)) return x.forEach(visit);
      if ([].concat(x["@type"] || []).includes("JobPosting")) posting = x;
      else if (x["@graph"]) visit(x["@graph"]);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        visit(JSON.parse(s.textContent));
      } catch {}
    }
    return posting || {};
  };
  const posting = findPosting();
  const roleOf = () => {
    const h1 = document.querySelector("h1");
    return flat(posting.title || (h1 && h1.innerText) || meta("og:title") || document.title);
  };
  const companyOf = () => {
    const host = location.hostname.replace(/^www\./, "");
    const org = posting.hiringOrganization;
    return flat((org && (org.name || org)) || meta("og:site_name") || host.split(".").slice(-2, -1)[0] || host);
  };
  const role = roleOf();
  const company = companyOf();
  const main = document.querySelector("main, [role=main], article") || document.body;
  const description = (posting.description ? strip(posting.description) : main.innerText).replace(/\n{3,}/g, "\n\n");
  return { url: location.href.split("#")[0], role: role.slice(0, 200), company: String(company).slice(0, 120), description: description.slice(0, 12000) };
}

async function readPage(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageInfoInTab }).catch(() => []);
  if (res && res.result) return res.result;
  const tab = (await chrome.tabs.get(tabId).catch(() => null)) || {};
  return { url: (tab.url || "").split("#")[0], role: tab.title || "", company: "", description: "" };
}

function cvPath(jobId, page) {
  if (jobId) return `/api/jobs/${encodeURIComponent(jobId)}/cv`;
  const { role = "", company = "" } = page || {};
  return `/api/apply/cv?role=${encodeURIComponent(role || "")}&company=${encodeURIComponent(company || "")}`;
}

async function fetchCv(jobId, page) {
  const res = await fetch(`${await baseUrl()}${cvPath(jobId, page)}`);
  if (!res.ok) throw new Error("Could not build the CV PDF.");
  const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "CV.pdf";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, base64: btoa(binary) };
}

const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "No AI used" or "AI: 3 calls · 4.5k tokens in / 312 out (Claude Code)"
function describeAi(stats) {
  if (!stats || !stats.aiCalls) return "No AI used";
  return (
    `AI: ${plural(stats.aiCalls, "call")} · ${fmt(stats.inTokens || 0)} tokens in / ${fmt(stats.outTokens || 0)} out` +
    (stats.aiName ? ` (${stats.aiName})` : "")
  );
}

// "5 profile · 6 answer bank · 1 AI"
function describeSources(stats) {
  if (!stats) return "";
  const names = { profile: "profile", bank: "answer bank", saved: "your answers", learned: "remembered", ai: "AI" };
  return Object.entries(names).filter(([k]) => stats[k]).map(([k, n]) => `${stats[k]} ${n}`).join(" · ");
}

// The last fill of each tab, kept until the browser closes so the popup can show it again.
const reportKey = (tabId) => `report:${tabId}`;
const saveReport = (tabId, report) => chrome.storage.session.set({ [reportKey(tabId)]: report }).catch(() => {});
const savedReport = async (tabId) => (await chrome.storage.session.get(reportKey(tabId)))[reportKey(tabId)];

const POLLS = 120;
// Quick checks first, then a slower pace while the AI writes.
const pollDelay = (i) => (i < 4 ? 400 : 1500);

// Asks JobPilot to answer fields (AI included) and waits for the result.
// Without a saved job, `page` (what the page says about the job) stands in for it.
async function answerFields({ jobId, page, fields, forceAi }) {
  const { ticket } = await call("/api/apply/answers", json({ jobId: jobId || null, page: jobId ? null : page, fields, forceAi }));
  for (let i = 0; i < POLLS; i++) {
    // eslint-disable-next-line no-await-in-loop -- polling: each check waits for the one before, and stops at the first finished answer
    await sleep(pollDelay(i));
    // eslint-disable-next-line no-await-in-loop -- polling (see above)
    const r = await call(`/api/apply/answers?ticket=${ticket}`);
    if (r.answers) return r;
  }
  throw new Error("Writing the answers took too long. Press Fill again.");
}

// The job a tab's form belongs to, decided in one place for the popup, Fill,
// suggestions and Ask AI:
//   1. a saved job whose link matches this page;
//   2. the job this tab was opened for (a JobPilot link, a pick in the popup,
//      or the tab that opened it, e.g. LinkedIn's "Apply" opening the company site);
//   3. the job you last opened from JobPilot, within 3 hours.
const jobKey = (tabId) => `job:${tabId}`;
const setTabJob = (tabId, jobId) => chrome.storage.session.set({ [jobKey(tabId)]: jobId || null });
const tabJob = async (tabId) => (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)];

async function resolveTabJob(tabId, url) {
  const ctx = (await call(`/api/apply/context?url=${encodeURIComponent(url || "")}`).catch(() => null)) || {};
  const job = ctx.job;
  if (ctx.matchedBy === "url" && job) {
    await setTabJob(tabId, job.id);
    return { id: job.id, how: "url", ctx };
  }
  const saved = await tabJob(tabId);
  if (saved) return { id: saved, how: "tab", ctx };
  if (job) {
    await setTabJob(tabId, job.id);
    return { id: job.id, how: "opened", ctx };
  }
  return { id: null, how: null, ctx };
}

async function jobForTab(tabId, url) {
  return (await resolveTabJob(tabId, url)).id;
}

// A listing opened from JobPilot carries #jobpilot-job=<id>.
const TAG = /#jobpilot-job=([^&]+)/;
chrome.tabs.onUpdated.addListener((tabId, info) => {
  const m = info.url && info.url.match(TAG);
  if (m) setTabJob(tabId, decodeURIComponent(m[1]));
});
// A tab opened from a job's tab (an "Apply on company site" button) is for the same job.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId) return;
  const parent = await tabJob(tab.openerTabId);
  if (parent) setTabJob(tab.id, parent);
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([jobKey(tabId), reportKey(tabId)]).catch(() => {}));

async function suggestFor(tabId, url, fields) {
  const jobId = await jobForTab(tabId, url);
  const r = await call("/api/apply/suggest", json({ url, jobId, fields }));
  if (r.jobId && r.jobId !== jobId) await setTabJob(tabId, r.jobId);
  return { answers: r.answers };
}

async function askAiFor(tabId, url, fields) {
  const jobId = await jobForTab(tabId, url);
  const page = jobId ? null : await readPage(tabId);
  const { answers } = await answerFields({ jobId, page, fields, forceAi: true });
  return { answers };
}

function jobLabelFor(jobId, jobLabel, page) {
  if (jobId) return jobLabel || "";
  return `From this page · ${[page.company, page.role].filter(Boolean).join(" · ") || "unknown job"}`;
}

async function fillTab({ tabId, jobId, jobLabel, attachCv }) {
  const tab = (await chrome.tabs.get(tabId).catch(() => null)) || {};
  await setTabJob(tabId, jobId);
  // Not a saved job: the page itself says what the job is.
  const page = jobId ? null : await readPage(tabId);
  const base = { at: Date.now(), url: tab.url || "", jobId: jobId || null, page, job: jobLabelFor(jobId, jobLabel, page) };
  await saveReport(tabId, { ...base, status: "running" });
  try {
    const report = await runFill({ tabId, jobId, page, attachCv });
    await saveReport(tabId, { ...base, ...report, status: "done", at: Date.now() });
    return report;
  } catch (err) {
    await saveReport(tabId, { ...base, status: "error", error: errorText(err), at: Date.now() });
    throw err;
  }
}

/** Every frame's empty fields, with ids made unique as "<frameId>:<id>". */
function gatherFields(collected) {
  const fields = [];
  let wantsCv = false;
  for (const frame of collected) {
    if (!frame.result) continue;
    wantsCv = wantsCv || frame.result.wantsCv;
    for (const f of frame.result.fields) fields.push({ ...f, id: `${frame.frameId}:${f.id}` });
  }
  return { fields, wantsCv };
}

/** Answers grouped by the frame they go to, ids back to the frame's own. */
function answersByFrame(answers) {
  const byFrame = new Map();
  for (const a of answers) {
    const cut = a.id.indexOf(":");
    const frameId = Number(a.id.slice(0, cut));
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push({ id: a.id.slice(cut + 1), value: a.value, source: a.source, rule: a.rule });
  }
  return byFrame;
}

/** Writes each frame's answers; frames are independent, so they are filled together. */
async function fillFrames(tabId, byFrame, cv) {
  const outs = await Promise.all(
    [...byFrame].map(([frameId, list]) =>
      chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func: (a, c) => window.__jobpilot.fill(a, c), args: [list, cv] }),
    ),
  );
  return outs.flatMap(([out]) => (out && out.result) || []);
}

const needsYou = (r) => r.required || r.status === "check";
const names = (list) => list.slice(0, 4).map((r) => r.label.slice(0, 40)).join(", ") + (list.length > 4 ? "…" : "");

// The note on the page after a fill: what was filled, what is left, and where answers came from.
function fillSummary(results, stats) {
  const filled = results.filter((r) => r.status === "filled").length;
  const open = results.filter((r) => r.status === "blank" || r.status === "check");
  const required = open.filter(needsYou);
  const optional = open.filter((r) => !needsYou(r));
  const sources = describeSources(stats);
  const text =
    `Filled ${plural(filled, "field")} (green).` +
    (required.length ? `\n${required.length} required left for you (amber): ${names(required)}` : "\nEvery required field is filled.") +
    (optional.length ? `\n${optional.length} optional left empty: ${names(optional)}` : "") +
    (sources ? `\n${sources}` : "") +
    `\n${describeAi(stats)}` +
    "\nAnything you type or pick yourself is saved for next time.";
  return { text, tone: required.length ? "" : "good" };
}

async function runFill({ tabId, jobId, page, attachCv }) {
  await inFrames(tabId, { files: FILLER_FILES });
  const { fields, wantsCv } = gatherFields(await inFrames(tabId, { func: () => window.__jobpilot.collect() }));
  if (!fields.length) {
    await banner(tabId, "No empty fields found on this page.", "");
    return { results: [], stats: null, note: "No empty fields found on this page." };
  }

  await banner(tabId, `Writing answers for ${fields.length} fields…`, "");
  const { answers, stats } = await answerFields({ jobId, page, fields, forceAi: false });
  const cv = wantsCv && attachCv ? await fetchCv(jobId, page).catch(() => null) : null;

  // Fields left empty on purpose (optional referrer, marketing opt-in) are not touched, only listed.
  const results = await fillFrames(tabId, answersByFrame(answers.filter((x) => !x.skip)), cv);
  const label = new Map(fields.map((f) => [f.id, f.label]));
  for (const a of answers.filter((x) => x.skip)) {
    results.push({ label: (label.get(a.id) || "").slice(0, 120), status: "skipped", source: a.source, rule: a.rule || "", value: "" });
  }

  const { text, tone } = fillSummary(results, stats);
  await banner(tabId, text, tone);
  return { results, stats };
}

/** The report with these answers added; the newest answer per question wins. */
function withLearned(report, saved) {
  const byQuestion = new Map((report.learned || []).map((x) => [x.question, x]));
  for (const x of saved) byQuestion.set(x.question, { ...x, at: Date.now() });
  return { ...report, learned: [...byQuestion.values()], learnError: "" };
}

// Answers you gave yourself on the page, sent by filler.js when you press Submit / Next.
async function learnFromPage(tabId, items) {
  const report = (await savedReport(tabId)) || {};
  try {
    const page = report.jobId ? null : report.page || (await readPage(tabId));
    const { saved } = await call("/api/apply/learned", json({ jobId: report.jobId || null, page, items }));
    if (saved.length) await saveReport(tabId, withLearned((await savedReport(tabId)) || report, saved));
    return { saved };
  } catch (err) {
    const error = errorText(err);
    await saveReport(tabId, { ...((await savedReport(tabId)) || report), learnError: error });
    return { error };
  }
}

async function fillAndReport(msg) {
  try {
    return await fillTab(msg);
  } catch (err) {
    // The popup may close before this finishes; it reads the saved report instead.
    const error = errorText(err);
    await banner(msg.tabId, error, "bad");
    return { error };
  }
}

const senderTab = (sender) => sender.tab || null;

// Each message type: a handler returning a promise of the reply, or null when the message is not for us.
const HANDLERS = {
  // The popup asks which job a tab is for, or sets it when you pick one.
  tabJob: (msg) => resolveTabJob(msg.tabId, msg.url).then((r) => ({ id: r.id, how: r.how })),
  // The popup's "Add this job" reads the page the same way Fill does.
  readPage: (msg) => readPage(msg.tabId),
  setTabJob: (msg) => setTabJob(msg.tabId, msg.jobId).then(() => ({ ok: true })),
  // The page script found #jobpilot-job=<id> in the address.
  taggedJob: (msg, sender) => senderTab(sender) && setTabJob(sender.tab.id, msg.jobId).then(() => ({ ok: true })),
  suggest: (msg, sender) => senderTab(sender) && suggestFor(sender.tab.id, msg.url || sender.tab.url, msg.fields || []),
  askAi: (msg, sender) => senderTab(sender) && askAiFor(sender.tab.id, msg.url || sender.tab.url, msg.fields || []),
  learn: (msg, sender) => {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    return tabId && Array.isArray(msg.items) ? learnFromPage(tabId, msg.items) : null;
  },
  fill: (msg) => fillAndReport(msg),
};

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const handler = msg && Object.hasOwn(HANDLERS, msg.type) ? HANDLERS[msg.type] : null;
  const reply = handler && handler(msg, sender);
  if (!reply) return;
  reply.then(respond, (err) => respond({ error: errorText(err) }));
  return true;
});
