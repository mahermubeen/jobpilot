// Page script 5 of 5 (see manifest.json): ties the others together and gives
// the extension `window.__jobpilot`. Runs inside the application page. It reads
// the empty form fields, and later writes the answers JobPilot returns. It never
// clicks Next, Review or Submit. When you press one, the answers you typed or
// picked yourself are sent to JobPilot and remembered for the next form.
(() => {
  if (window.__jobpilot) return;
  const JP = window.__jobpilotLib;
  const { scope } = JP.dom;
  const { state, collect, fill, banner } = JP.form;
  const { flush, armLearning, alive } = JP.learn;
  const { mode, suggesting, showChip, applyAnswer, offerOnFocus, clearAll } = JP.suggest;

  // Opened from JobPilot: the address carries #jobpilot-job=<id>. Tell the
  // extension which job this tab is for, then take the mark out of the address.
  if (window.top === window && /^#jobpilot-job=/.test(location.hash)) {
    const jobId = decodeURIComponent(location.hash.slice("#jobpilot-job=".length));
    try {
      chrome.runtime.sendMessage({ type: "taggedJob", jobId }).catch(() => {});
      history.replaceState(history.state, "", location.pathname + location.search);
    } catch {
      // The extension was reloaded; the background reads the mark from the tab's address too.
    }
  }

  let lastScan = 0;
  let scanning = false;
  let assisting = false;

  const isOption = (f) => f.type === "radio" || f.type === "checkbox";
  // On LinkedIn, application questions only appear in the Easy Apply dialog;
  // elsewhere (feed, search) the page's own boxes are left alone.
  const outsideLinkedInDialog = () => /(^|\.)linkedin\.com$/.test(location.hostname) && scope() === document;

  // Whether to look for new fields now: not while filling or already looking, not more than every 0.7 s unless `fresh`.
  function shouldScan(fresh) {
    if (state.filling || scanning || !alive()) return false;
    if (!fresh && Date.now() - lastScan < 700) return false;
    return !outsideLinkedInDialog();
  }

  // What to show for one field JobPilot answered (or did not).
  async function offerAnswer(f, found) {
    const a = found && found.value !== null ? found : null;
    if (a && mode.prefs.autoFill) {
      showChip(f.id, a);
      await applyAnswer(f.id, a);
    } else if (a && (isOption(f) || mode.prefs.showAll)) {
      // Options have no box to click into, so a known answer gets a card under the question.
      showChip(f.id, a);
    } else if (!isOption(f)) {
      // Text boxes and dropdowns: a list when you click in (Ask AI is there even with no answer).
      offerOnFocus(f.id, found);
    }
    // An option question JobPilot knows nothing about gets nothing, so the page stays clean.
  }

  // Reads the form (only new fields unless `fresh`) and asks JobPilot what it already knows about them.
  async function suggestFields(fresh) {
    // Fields are always read, so answers you give yourself are saved even with suggestions off.
    const fields = collect(fresh === true ? undefined : { keep: true }).fields.filter((f) => f.type !== "file");
    if (!fields.length || !suggesting()) return;
    const reply = await chrome.runtime.sendMessage({ type: "suggest", url: location.href, fields });
    if (!reply || reply.error) return;
    const byId = new Map((reply.answers || []).map((a) => [a.id, a]));
    for (const f of fields) {
      // eslint-disable-next-line no-await-in-loop -- auto-fill writes one field at a time (it takes focus); otherwise this only shows chips
      await offerAnswer(f, byId.get(f.id) || null);
    }
  }

  // Looks for new empty fields and asks JobPilot what it already knows about them.
  // `fresh`: read the whole form again (suggestions were just switched on), not only new fields.
  async function suggestNew(fresh) {
    if (!shouldScan(fresh)) return;
    lastScan = Date.now();
    scanning = true;
    try {
      await suggestFields(fresh);
    } catch {
      // The extension was reloaded or JobPilot is not running; try again on the next change.
    } finally {
      scanning = false;
    }
  }

  // Suggestions were switched on or off: show them for the whole form, or take them all away.
  function applyMode() {
    if (suggesting()) suggestNew(true);
    else clearAll();
  }

  // Keeps the popup's choices (Everywhere, auto-fill, show all) in step.
  function onPrefsChanged(changes, area) {
    if (area !== "local") return;
    const was = suggesting();
    for (const k of ["suggest", "autoFill", "showAll"]) if (changes[k]) mode.prefs[k] = !!changes[k].newValue;
    if (was !== suggesting()) applyMode();
  }

  async function startAssist() {
    if (assisting || (window.top !== window && !document.querySelector("input, textarea, select"))) return;
    assisting = true;
    try {
      Object.assign(mode.prefs, await chrome.storage.local.get({ suggest: false, autoFill: false, showAll: false }));
      chrome.storage.onChanged.addListener(onPrefsChanged);
    } catch {
      return;
    }
    armLearning();
    let pendingScan = 0;
    new MutationObserver(() => {
      clearTimeout(pendingScan);
      pendingScan = setTimeout(suggestNew, 400);
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Changes inside shadow roots are not seen by the observer; check now and then too.
    setInterval(suggestNew, 2500);
    suggestNew();
  }

  // For the popup: what is switched on, and how many form fields are seen.
  const watching = () => ({
    on: assisting && suggesting(),
    mode: mode.prefs.suggest ? "everywhere" : mode.pageOn ? "page" : "off",
    fields: state.marked.size,
    inWindow: scope() !== document,
  });

  // "This page" in the popup: suggestions on this tab until the page is left.
  function setPage(on) {
    const was = suggesting();
    mode.pageOn = !!on;
    if (was !== suggesting()) applyMode();
    return watching();
  }

  window.__jobpilot = { collect, fill, banner, flush, suggestNew, watching, setPage };
  startAssist();
})();
