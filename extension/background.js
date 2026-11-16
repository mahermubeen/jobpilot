// Orchestrates one "Fill this page" press: read the fields from the tab, ask
// the local JobPilot app for answers, write them back. Runs here rather than
// in the popup so it keeps going when the popup closes.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function fetchCv(jobId) {
  const res = await fetch(`${await baseUrl()}/api/jobs/${encodeURIComponent(jobId)}/cv`);
  if (!res.ok) throw new Error("Could not build the CV PDF.");
  const name = (res.headers.get("content-disposition") || "").match(/filename="([^"]+)"/)?.[1] || "CV.pdf";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, base64: btoa(binary) };
}

async function fillTab({ tabId, jobId, attachCv }) {
  await inFrames(tabId, { files: ["filler.js"] });
  const collected = await inFrames(tabId, { func: () => window.__jobpilot.collect() });

  const fields = [];
  let wantsCv = false;
  for (const frame of collected) {
    if (!frame.result) continue;
    wantsCv = wantsCv || frame.result.wantsCv;
    for (const f of frame.result.fields) fields.push({ ...f, id: `${frame.frameId}:${f.id}` });
  }
  if (!fields.length) {
    await banner(tabId, "No empty fields found on this page.", "");
    return { results: [], note: "No empty fields found on this page." };
  }

  await banner(tabId, `Writing answers for ${fields.length} fields…`, "");
  const { ticket } = await call("/api/apply/answers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, fields }),
  });
  let answers = null;
  for (let i = 0; i < 120 && !answers; i++) {
    await sleep(1500);
    const r = await call(`/api/apply/answers?ticket=${ticket}`);
    if (r.answers) answers = r.answers;
  }
  if (!answers) throw new Error("Writing the answers took too long. Press Fill again.");

  const cv = wantsCv && attachCv ? await fetchCv(jobId).catch(() => null) : null;

  const byFrame = new Map();
  for (const a of answers) {
    const cut = a.id.indexOf(":");
    const frameId = Number(a.id.slice(0, cut));
    if (!byFrame.has(frameId)) byFrame.set(frameId, []);
    byFrame.get(frameId).push({ id: a.id.slice(cut + 1), value: a.value });
  }
  const results = [];
  for (const [frameId, list] of byFrame) {
    const [out] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (a, c) => window.__jobpilot.fill(a, c),
      args: [list, cv],
    });
    if (out && out.result) results.push(...out.result);
  }

  const filled = results.filter((r) => r.status === "filled").length;
  const left = results.length - filled;
  await banner(
    tabId,
    `Filled ${filled} field${filled === 1 ? "" : "s"} (green).` +
      (left ? `\n${left} left for you (amber).` : "") +
      "\nCheck every answer, then submit yourself.",
    "good",
  );
  return { results };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.type === "fill") {
    fillTab(msg).then(respond, async (err) => {
      const error = String((err && err.message) || err);
      await banner(msg.tabId, error, "bad");
      respond({ error });
    });
    return true;
  }
});
