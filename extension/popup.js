const $ = (id) => document.getElementById(id);
const status = (message, bad) => {
  $("status").textContent = message;
  $("status").className = bad ? "bad" : "";
};

let tab = null;

async function connect() {
  const { port } = await chrome.storage.local.get({ port: 3000 });
  $("port").value = port;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("fill").disabled = true;
  $("job").replaceChildren();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/apply/context?url=${encodeURIComponent(tab?.url || "")}`);
    const ctx = await res.json();
    if (!res.ok) throw new Error(ctx.error || "JobPilot answered with an error.");
    const jobs = ctx.job && !ctx.jobs.some((j) => j.id === ctx.job.id) ? [ctx.job, ...ctx.jobs] : ctx.jobs;
    for (const j of jobs) {
      const o = document.createElement("option");
      o.value = j.id;
      o.textContent = `${j.company} · ${j.role}`;
      $("job").append(o);
    }
    if (ctx.job) $("job").value = ctx.job.id;
    if (!ctx.profileReady) return status("Add your CV in JobPilot Settings first.", true);
    if (!jobs.length) return status("No jobs saved in JobPilot yet.", true);
    $("fill").disabled = false;
    status(
      ctx.matchedBy === "url" ? "This page matches a saved job."
      : ctx.matchedBy === "opened" ? "Using the job you last opened from JobPilot."
      : "Pick the job this form belongs to.",
    );
  } catch (err) {
    status(err instanceof TypeError ? "JobPilot is not running. Start it with npm start." : String(err.message || err), true);
  }
}

$("port").addEventListener("change", async () => {
  await chrome.storage.local.set({ port: Number($("port").value) || 3000 });
  connect();
});

$("fill").addEventListener("click", async () => {
  $("fill").disabled = true;
  $("results").replaceChildren();
  status("Reading the form and writing answers. This can take up to a minute…");
  const reply = await chrome.runtime.sendMessage({ type: "fill", tabId: tab.id, jobId: $("job").value, attachCv: $("cv").checked });
  $("fill").disabled = false;
  if (!reply || reply.error) return status(reply ? reply.error : "The extension did not answer. Reload it and try again.", true);
  if (reply.note) return status(reply.note);
  const filled = reply.results.filter((r) => r.status === "filled").length;
  status(`Filled ${filled} of ${reply.results.length}. Amber fields are left for you. Check everything before you submit.`);
  for (const r of reply.results) {
    const li = document.createElement("li");
    li.className = r.status;
    li.textContent = r.label + (r.status === "check" ? " (pick from its list)" : r.status === "blank" ? " (left for you)" : "");
    $("results").append(li);
  }
});

connect();
