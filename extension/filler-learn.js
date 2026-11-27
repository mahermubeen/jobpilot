// Page script 3 of 5 (see manifest.json): saving the answers you give yourself.
// When you press Next, Submit or Continue (or a moment after you answer), the
// fields you typed or picked yourself are sent to JobPilot and remembered for the next form.
(() => {
  const JP = (window.__jobpilotLib = window.__jobpilotLib || {});
  if (JP.learn) return;
  const { text, readValue } = JP.dom;
  const { state, hooks } = JP.form;

  const TYPING = /^(text|textarea|email|tel|url|number|date)$/;
  const norm = (v) => (Array.isArray(v) ? [...v].sort().join("|") : String(v ?? "")).trim().toLowerCase();

  // Whether a field is worth sending now: read, not a file, not being typed in, and changed since it was last saved or filled.
  function changedValue(id, els) {
    const m = state.meta.get(id);
    if (!m || m.type === "file") return null;
    // Still typing: saved when you leave the box.
    if (document.activeElement === els[0] && TYPING.test(m.type)) return null;
    const now = readValue(els);
    if (now === null) return null;
    if (state.wrote.has(id) && norm(state.wrote.get(id)) === norm(now)) return null;
    return { id, label: m.label, type: m.type, options: m.options, value: now };
  }

  // Answers you gave yourself: fields JobPilot left, or ones you changed after it filled them.
  function pending() {
    const items = [];
    for (const [id, els] of state.marked) {
      const item = changedValue(id, els);
      if (item) items.push(item);
    }
    return items;
  }

  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  };

  // A short note at the top right that fades out.
  function toast(message, bad) {
    if (window.top !== window) return;
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483647;max-width:380px;padding:10px 12px;border-radius:10px;" +
      "font:600 12px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);white-space:pre-line;transition:opacity .4s;" +
      `background:${bad ? "#b42318" : "#0d9488"}`;
    box.textContent = message;
    document.documentElement.appendChild(box);
    setTimeout(() => (box.style.opacity = "0"), bad ? 8000 : 4000);
    setTimeout(() => box.remove(), bad ? 8500 : 4500);
  }

  let armed = false;
  let ticker = 0;
  let pausedUntil = 0;

  const short = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

  // JobPilot did not save them: put the old values back so they are sent again, in 30 s rather than on every check.
  function retryLater(before, reply) {
    for (const [id, v] of before) {
      if (v === undefined) state.wrote.delete(id);
      else state.wrote.set(id, v);
    }
    pausedUntil = Date.now() + 30_000;
    toast(`Could not save your answer: ${(reply && reply.error) || "the extension did not answer"}`, true);
  }

  function saved(reply) {
    if (!reply.saved || !reply.saved.length) return;
    toast("Saved to JobPilot:\n" + reply.saved.map((x) => `${short(x.question, 70)} → ${short([].concat(x.answer).join(", "), 60)}`).join("\n"));
  }

  // Sends your own answers to JobPilot so the next form gets them filled.
  // Returns how many were sent; the toast on the page says whether they were saved.
  function flush() {
    const items = pending();
    if (!items.length) return 0;
    if (!alive()) {
      clearInterval(ticker);
      toast("JobPilot was updated. Reload this page so it can save your answers.", true);
      return 0;
    }
    if (Date.now() < pausedUntil) return 0;
    const before = new Map(items.map((it) => [it.id, state.wrote.get(it.id)]));
    for (const it of items) state.wrote.set(it.id, it.value);
    const payload = items.map((it) => ({ label: it.label, type: it.type, options: it.options, value: it.value }));
    chrome.runtime
      .sendMessage({ type: "learn", items: payload })
      .then((reply) => (!reply || reply.error ? retryLater(before, reply) : saved(reply)))
      .catch(() => {});
    return items.length;
  }

  const MOVE_ON = /submit|apply|send|next|continue|review|save|finish|done/i;
  const BUTTON = 'button, input[type="submit"], input[type="button"], [role="button"], a';

  // A click on Submit, Next, Continue and the like saves at once.
  function onMoveOnClick(e) {
    const b = e.target && e.target.closest && e.target.closest(BUTTON);
    if (!state.filling && b && MOVE_ON.test(text(b) || b.value || b.getAttribute("aria-label") || "")) flush();
  }

  // Your answers are saved a moment after you give them: any click, typing or
  // change schedules a check, and a light check runs every 2 s for widgets
  // that change values without telling anyone. Submit / Next and leaving the
  // page save too.
  function armLearning() {
    if (armed) return;
    armed = true;
    const soon = () => {
      if (state.filling) return;
      clearTimeout(state.timer);
      state.timer = setTimeout(flush, 1200);
    };
    for (const type of ["change", "input", "click", "focusout"]) document.addEventListener(type, soon, true);
    document.addEventListener("submit", () => !state.filling && flush(), true);
    document.addEventListener("click", onMoveOnClick, true);
    window.addEventListener("pagehide", () => !state.filling && flush());
    ticker = setInterval(() => !state.filling && flush(), 2000);
  }

  hooks.onCollected = armLearning;
  JP.learn = { flush, armLearning, alive };
})();
