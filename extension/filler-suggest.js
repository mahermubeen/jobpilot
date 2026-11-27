// Page script 4 of 5 (see manifest.json): answer suggestions on the page.
// A chip under a question offers a known answer for options (radios,
// checkboxes); text boxes and dropdowns get a list when you click into them,
// like Chrome's own autofill. Both can ask the AI for one field.
(() => {
  const JP = (window.__jobpilotLib = window.__jobpilotLib || {});
  if (JP.suggest) return;
  const { shown, questionBlock, readValue } = JP.dom;
  const { state, hooks } = JP.form;

  // prefs.suggest: "Everywhere" in the popup. pageOn: "This page" (until the page is left).
  const mode = { prefs: { suggest: false, autoFill: false, showAll: false }, pageOn: false };
  const suggesting = () => mode.prefs.suggest || mode.pageOn;
  // Suggestions for text boxes and dropdowns, shown in a list when you click into the field.
  const offers = new Map(); // field id -> answer | null
  const chips = new Map(); // field id -> { box, els, answer, state }
  let overlay = null;
  let looping = false;
  let menu = null; // { id, el, box, items, on, state, error, keep }

  const SOURCE_NAME = { profile: "CV", bank: "answer bank", saved: "yours", learned: "record", ai: "AI" };
  const SOURCE_COLOR = { profile: "#475467", bank: "#475467", saved: "#0d9488", learned: "#2563eb", ai: "#8b5cf6" };
  const STYLE = `<style>
      .chip { position: fixed; pointer-events: auto; display: flex; align-items: center; gap: 6px; max-width: 560px;
        padding: 4px 6px 4px 8px; border-radius: 8px; background: #101828; color: #fff; font: 600 12px/1.35 system-ui, sans-serif;
        box-shadow: 0 4px 14px rgba(0,0,0,.3); cursor: pointer; transition: opacity .3s; }
      .chip:hover { background: #1d2939; }
      .brand { color: #7b8cff; }
      .tag { padding: 0 5px; border-radius: 5px; font-size: 11px; }
      .ans { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      button { font: inherit; border: 0; border-radius: 6px; padding: 2px 8px; cursor: pointer; color: #fff; background: #3b4cca; }
      button.x { background: transparent; color: #98a2b3; padding: 0 4px; }
      .done { background: #14724a; }
      .bad { background: #b42318; }
      .menu { position: fixed; pointer-events: auto; min-width: 260px; max-width: 560px; padding: 4px; border-radius: 10px;
        background: #101828; color: #fff; font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
      .head { padding: 3px 8px 5px; font-size: 11px; font-weight: 700; color: #7b8cff; }
      .item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 7px; cursor: pointer; }
      .item.on, .item:hover { background: #2a3550; }
      .item .ans { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item.ai { color: #c4b5fd; border-top: 1px solid #2a3550; border-radius: 0 0 7px 7px; }
      .note { padding: 6px 8px; color: #fda29b; }
    </style>`;

  function overlayRoot() {
    if (overlay && overlay.host.isConnected) return overlay;
    const host = document.createElement("div");
    host.id = "jobpilot-suggestions";
    host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = STYLE;
    document.documentElement.appendChild(host);
    overlay = { host, shadow };
    return overlay;
  }

  const child = (parent, tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    parent.append(e);
    return e;
  };
  const sourceTag = (parent, source) => {
    const tag = child(parent, "span", "tag", SOURCE_NAME[source] || source);
    tag.style.background = SOURCE_COLOR[source] || "#475467";
    return tag;
  };
  const shownValue = (value, el) =>
    Array.isArray(value) ? value.join(", ") : value === "yes" && el && el.type === "checkbox" ? "tick it" : String(value);
  const hasValue = (v) => v !== null && v !== undefined;

  // Where a chip sits: under the field, or under the question for a group of options.
  function anchorOf(els) {
    const block = els.length > 1 ? questionBlock(els) : null;
    if (block) return block.node;
    const el = els[0];
    return el.type === "radio" || el.type === "checkbox" || !shown(el) ? el.closest("label") || el.parentElement || el : el;
  }

  function clearChips() {
    for (const c of chips.values()) c.box.remove();
    chips.clear();
    closeMenu();
  }

  function dropChip(id) {
    const c = chips.get(id);
    if (c) c.box.remove();
    chips.delete(id);
  }

  // The chip's middle: what it offers, or what is happening.
  function chipBody(c) {
    const box = c.box;
    if (c.state === "error") return void child(box, "span", "ans", c.error);
    if (c.state === "asking") return void child(box, "span", "ans", "Asking AI…");
    if (!c.answer) {
      child(box, "span", "ans", "No saved answer");
      return void child(box, "button", "", "Ask AI");
    }
    sourceTag(box, c.answer.source);
    const text = shownValue(c.answer.value, c.els[0]);
    child(box, "span", "ans", text).title = text;
    child(box, "button", "", "Fill");
  }

  const CHIP_CLASS = { done: "chip done", error: "chip bad" };

  function renderChip(id) {
    const c = chips.get(id);
    if (!c) return;
    c.box.className = CHIP_CLASS[c.state] || "chip";
    c.box.replaceChildren();
    child(c.box, "span", "brand", "JobPilot");
    if (c.state === "done") return void child(c.box, "span", "ans", "✓ Filled");
    chipBody(c);
    const x = child(c.box, "button", "x", "✕");
    x.title = "Hide this suggestion";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      dropChip(id);
    });
  }

  function showChip(id, answer) {
    const els = state.marked.get(id);
    if (!els) return;
    const box = document.createElement("div");
    overlayRoot().shadow.appendChild(box);
    chips.set(id, { box, els, answer, state: "ready" });
    box.addEventListener("click", () => chipClicked(id));
    renderChip(id);
    follow();
  }

  async function applyAnswer(id, answer) {
    const c = chips.get(id);
    const [r] = await JP.form.fill([{ id, value: answer.value, source: answer.source }], null);
    if (!c) return;
    if (r && r.status === "filled") {
      c.state = "done";
      renderChip(id);
      setTimeout(() => {
        c.box.style.opacity = "0";
        setTimeout(() => dropChip(id), 350);
      }, 1200);
    } else {
      c.state = "error";
      c.error = "Could not fill this one — pick it yourself";
      renderChip(id);
    }
  }

  // One small AI call for just this field; JobPilot remembers its answer.
  // Resolves to { answer } or { error }, where error is the AI's own message or null.
  async function askAi(id) {
    const m = state.meta.get(id);
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "askAi",
        url: location.href,
        fields: [{ id, label: m.label, type: m.type, options: m.options, required: m.required }],
      });
      const answer = reply && reply.answers && reply.answers.find((x) => hasValue(x.value));
      return !reply || reply.error || !answer ? { error: (reply && reply.error) || null } : { answer };
    } catch {
      return { failed: true };
    }
  }

  const NOT_ANSWERING = "JobPilot did not answer. Reload this page.";

  async function chipClicked(id) {
    const c = chips.get(id);
    if (!c || c.state === "asking" || c.state === "done") return;
    if (c.answer) return applyAnswer(id, c.answer);
    c.state = "asking";
    renderChip(id);
    const got = await askAi(id);
    if (got.answer) Object.assign(c, { answer: got.answer, state: "ready" });
    else Object.assign(c, { state: "error", error: got.failed ? NOT_ANSWERING : got.error || "The AI had no answer. Fill it yourself; it will be saved." });
    renderChip(id);
  }

  // Puts a chip under its anchor; false when the chip should go (its field left the page, or got a value).
  function placeChip(c) {
    const anchor = anchorOf(c.els);
    if (!c.els[0].isConnected || !anchor.isConnected) return false;
    if (c.state !== "done" && readValue(c.els) !== null) return false;
    const r = anchor.getBoundingClientRect();
    c.box.style.display = !r.width && !r.height ? "none" : "flex";
    c.box.style.left = Math.max(4, r.left) + "px";
    c.box.style.top = Math.min(window.innerHeight - 30, r.bottom + 4) + "px";
    return true;
  }

  // Keeps every chip under its field while the page or a dialog scrolls; drops
  // chips whose field disappeared or got a value.
  function follow() {
    if (looping) return;
    looping = true;
    const step = () => {
      for (const [id, c] of chips) if (!placeChip(c)) dropChip(id);
      if (chips.size) requestAnimationFrame(step);
      else looping = false;
    };
    requestAnimationFrame(step);
  }

  // ---------- the list that opens when you click into a field (like Chrome's autofill) ----------

  function offerOnFocus(id, found) {
    const els = state.marked.get(id);
    if (!els) return;
    offers.set(id, found);
    const el = els[0];
    // The field's current id: it changes when the form is read again.
    const first = !el.__jobpilotOffer;
    el.__jobpilotOffer = id;
    if (first) {
      const open = () => openMenu(el.__jobpilotOffer);
      el.addEventListener("focus", open);
      el.addEventListener("click", open);
      el.addEventListener("keydown", menuKeys, true);
      el.addEventListener("blur", () => setTimeout(() => menu && menu.id === el.__jobpilotOffer && !menu.keep && closeMenu(), 150));
    }
    if (document.activeElement === el || el.getRootNode().activeElement === el) openMenu(id);
  }

  function menuItems(id) {
    const found = offers.get(id) || {};
    const items = [];
    if (hasValue(found.value)) items.push({ value: found.value, source: found.source });
    for (const alt of found.alternatives || []) items.push(alt);
    items.push({ ai: true });
    return items;
  }

  function openMenu(id) {
    if (!suggesting() || state.filling) return;
    const els = state.marked.get(id);
    if (!els || readValue(els) !== null) return;
    if (menu && menu.id === id) return;
    closeMenu();
    const box = document.createElement("div");
    box.className = "menu";
    // Keep the field focused while clicking in the list.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    overlayRoot().shadow.appendChild(box);
    menu = { id, el: els[0], box, items: menuItems(id), on: 0, state: "ready" };
    drawMenu();
    trackMenu();
  }

  function closeMenu() {
    if (menu) menu.box.remove();
    menu = null;
  }

  function menuRow(it, i) {
    const row = child(menu.box, "div", "item" + (i === menu.on ? " on" : "") + (it.ai ? " ai" : ""));
    if (it.ai) {
      row.textContent = "✨ Ask AI for this answer";
    } else {
      sourceTag(row, it.source);
      const ans = child(row, "span", "ans", shownValue(it.value));
      ans.title = ans.textContent;
    }
    row.addEventListener("click", () => pickItem(i));
  }

  function drawMenu() {
    if (!menu) return;
    menu.box.replaceChildren();
    child(menu.box, "div", "head", "JobPilot");
    if (menu.state === "asking") return void (child(menu.box, "div", "note", "Asking AI…").style.color = "#c4b5fd");
    menu.items.forEach(menuRow);
    if (menu.state === "error") child(menu.box, "div", "note", menu.error);
  }

  // The list after asking the AI for this field: its answer to pick, or why there is none.
  function showAiAnswer(id, got) {
    menu.keep = false;
    if (got.answer) {
      offers.set(id, { ...got.answer, alternatives: [] });
      Object.assign(menu, { items: [{ value: got.answer.value, source: "ai" }, { ai: true }], on: 0, state: "ready" });
    } else {
      Object.assign(menu, { state: "error", error: got.failed ? NOT_ANSWERING : got.error || "The AI had no answer. Type it yourself; it will be saved." });
    }
  }

  async function pickItem(i) {
    const it = menu && menu.items[i];
    if (!it) return;
    const id = menu.id;
    if (!it.ai) {
      closeMenu();
      await JP.form.fill([{ id, value: it.value, source: it.source }], null);
      return;
    }
    Object.assign(menu, { state: "asking", keep: true });
    drawMenu();
    const got = await askAi(id);
    // The list was closed, or moved to another field, while the AI was writing.
    if (!menu || (menu.id !== id && !got.failed)) return;
    showAiAnswer(id, got);
    drawMenu();
  }

  const STEP = { ArrowDown: 1, ArrowUp: -1 };

  // ↑ ↓ to move, Enter to fill, Esc to close — like Chrome's own list.
  function menuKeys(e) {
    if (!menu || e.currentTarget !== menu.el || menu.state === "asking") return;
    if (STEP[e.key]) {
      menu.on = (menu.on + STEP[e.key] + menu.items.length) % menu.items.length;
      drawMenu();
    } else if (e.key === "Enter") {
      pickItem(menu.on);
    } else if (e.key === "Escape") {
      closeMenu();
    } else {
      // Typing your own answer: get out of the way.
      if (e.key.length === 1) closeMenu();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // Keeps the list just above its field (Chrome's own list opens below).
  function trackMenu() {
    const step = () => {
      if (!menu) return;
      const els = state.marked.get(menu.id);
      if (!menu.el.isConnected || !els || (readValue(els) !== null && menu.state !== "asking")) return closeMenu();
      const r = menu.el.getBoundingClientRect();
      const h = menu.box.offsetHeight || 80;
      menu.box.style.left = Math.max(4, r.left) + "px";
      menu.box.style.top = (r.top - h - 6 >= 0 ? r.top - h - 6 : r.bottom + 6) + "px";
      menu.box.style.width = Math.min(560, Math.max(260, r.width)) + "px";
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Suggestions were switched off: take them all away.
  function clearAll() {
    clearChips();
    closeMenu();
    offers.clear();
  }

  hooks.onReset = clearChips;
  JP.suggest = { mode, suggesting, showChip, applyAnswer, offerOnFocus, clearAll };
})();
