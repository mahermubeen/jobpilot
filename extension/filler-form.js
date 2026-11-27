// Page script 2 of 5 (see manifest.json): reading the form's empty fields for
// JobPilot and writing its answers back. It never clicks Next, Review or Submit.
// A type-ahead box (city, school) gets its matching suggestion picked.
(() => {
  const JP = (window.__jobpilotLib = window.__jobpilotLib || {});
  if (JP.form) return;
  const { text, shown, questionFor, optionLabel, isRequired, deepAll, pageChrome, scope, cleanLabel, isCombo, readValue, setValue, same } = JP.dom;

  const GREEN = "2px solid #1f9d63";
  const AMBER = "2px solid #d97706";
  const SKIP_INPUT = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
  const TYPED_INPUT = new Set(["number", "email", "tel", "url", "date"]);
  const MAX_FIELDS = 60;

  // Shared by the page scripts:
  //   marked: field id -> its elements; meta: id -> { label, type, options, required } for every field read;
  //   wrote: id -> the value JobPilot (or you, once saved) last put there; known: element -> its id,
  //   so a page that grows (the next step of a form) only adds the new fields.
  const state = { marked: new Map(), meta: new Map(), wrote: new Map(), known: new WeakMap(), counter: 0, filling: false, timer: 0 };
  // Set by the other page scripts: what to do when the form is read from scratch, and once fields are read.
  const hooks = { onReset: () => {}, onCollected: () => {} };

  function mark(els) {
    const id = "jp" + ++state.counter;
    state.marked.set(id, els);
    for (const el of els) state.known.set(el, id);
    return id;
  }

  // A field that already has an answer: not sent to JobPilot, but watched, so
  // a change you make is saved. Its value now is the starting point.
  function watch(els, label, type, options) {
    const id = mark(els);
    state.meta.set(id, { label: cleanLabel(label), type, options, required: false });
    state.wrote.set(id, readValue(els));
  }

  function reset() {
    state.marked.clear();
    state.meta.clear();
    state.wrote.clear();
    state.known = new WeakMap();
    hooks.onReset();
  }

  const typeOf = (el, tag) => (tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag);
  const isCvUpload = (el, label) => {
    const hay = (label + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
    return /resume|résumé|\bcv\b|curriculum/.test(hay) || (!/cover|transcript|portfolio|photo|picture|avatar/.test(hay) && /pdf|doc|^$/.test((el.accept || "").toLowerCase()));
  };

  // One element of the form, by kind. Each adds a field to `read.fields`, watches a filled one, or leaves it.
  const READ = {
    file(el, read) {
      const label = questionFor(el);
      if (!isCvUpload(el, label) || el.files.length) return;
      read.wantsCv = true;
      read.fields.push({ id: mark([el]), label: label || "Resume / CV", type: "file" });
    },
    // Radios and checkboxes are read as groups, after every element is seen.
    option(el, read, type) {
      if (!shown(el) && !shown(el.closest("label")) && ![...(el.labels || [])].some(shown)) return;
      if (!el.name) return void read.groups.set({}, [el]);
      const formIndex = el.form ? Array.prototype.indexOf.call(document.forms, el.form) : "";
      const key = type + "|" + (el.name || el.id || "") + "|" + formIndex;
      if (!read.groups.has(key)) read.groups.set(key, []);
      read.groups.get(key).push(el);
    },
    select(el, read) {
      if (!shown(el)) return;
      const chosen = el.options[el.selectedIndex];
      const options = [...el.options].filter((o) => o.value && !o.disabled).map((o) => text(o)).filter(Boolean);
      if (!options.length) return;
      if (chosen && chosen.value && el.selectedIndex > 0) return watch([el], questionFor(el), "select", options);
      const label = questionFor(el);
      read.fields.push({ id: mark([el]), label, type: "select", options, required: isRequired([el], label) });
    },
    box(el, read, type, tag) {
      if (!shown(el)) return;
      const kind = tag === "textarea" ? "textarea" : TYPED_INPUT.has(type) ? type : "text";
      if (el.value.trim()) return watch([el], questionFor(el), kind);
      const label = questionFor(el);
      read.fields.push({ id: mark([el]), label, type: kind, required: isRequired([el], label), maxLength: el.maxLength > 0 ? el.maxLength : undefined });
    },
  };
  const readerFor = (type, tag) => (type === "file" ? "file" : type === "radio" || type === "checkbox" ? "option" : tag === "select" ? "select" : "box");

  function readElement(el, read) {
    if (el.disabled || el.readOnly || state.known.has(el) || pageChrome(el)) return;
    const tag = el.tagName.toLowerCase();
    const type = typeOf(el, tag);
    if (!SKIP_INPUT.has(type)) READ[readerFor(type, tag)](el, read, type, tag);
  }

  // A group of radios or checkboxes sharing a name (or one lone checkbox).
  function readGroup(els, fields) {
    if (els.some((e) => state.known.has(e))) return;
    const type = els[0].type;
    const single = type === "checkbox" && els.length === 1;
    const label = single ? optionLabel(els[0]) || questionFor(els[0]) : questionFor(els[0], els);
    if (els.some((e) => e.checked)) return watch(els, label, type, single ? undefined : els.map(optionLabel));
    if (single) fields.push({ id: mark(els), label, type: "checkbox", required: isRequired(els, label) });
    else fields.push({ id: mark(els), label, type, options: els.map(optionLabel), required: isRequired(els, label) });
  }

  // Reads the form's fields. `keep`: add only fields not seen before and keep
  // the rest (suggestions as fields appear); otherwise start over (Fill).
  function collect(opts) {
    if (!(opts && opts.keep)) reset();
    const read = { fields: [], groups: new Map(), wantsCv: false };
    for (const el of deepAll(scope(), "input, textarea, select")) {
      if (read.fields.length >= MAX_FIELDS) break;
      readElement(el, read);
    }
    for (const els of read.groups.values()) {
      if (read.fields.length >= MAX_FIELDS) break;
      readGroup(els, read.fields);
    }
    for (const f of read.fields) {
      if (f.type === "file") f.required = isRequired(state.marked.get(f.id), f.label);
      f.label = cleanLabel(f.label);
      state.meta.set(f.id, { label: f.label, type: f.type, options: f.options, required: !!f.required });
    }
    hooks.onCollected();
    return { fields: read.fields, wantsCv: read.wantsCv };
  }

  const outline = (el, style) => {
    const target = el.type === "radio" || el.type === "checkbox" || !shown(el) ? el.closest("label") || el.parentElement || el : el;
    target.style.outline = style;
    target.style.outlineOffset = "2px";
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const OPTION = '[role="listbox"] [role="option"], [role="option"], .pac-item, [class*="option" i][id*="option" i], [class*="suggestion" i] li, [class*="menu" i] [class*="option" i]';
  const CLICK = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

  // The suggestions a type-ahead box shows now: in the lists it owns, then anywhere on the page.
  function suggestionsFor(owned) {
    const roots = owned.map((id) => document.getElementById(id)).filter(Boolean);
    return [...roots.flatMap((r) => [...r.querySelectorAll('[role="option"], li')]), ...document.querySelectorAll(OPTION)].filter((o) => shown(o) && text(o));
  }

  // The suggestion that best fits `want`: the same text, then one starting with it, then one containing it.
  function bestSuggestion(pool, want) {
    const score = (o) => {
      const t = text(o).toLowerCase();
      return t === want ? 3 : t.startsWith(want) ? 2 : t.includes(want) ? 1 : 0;
    };
    const best = pool.map((o) => [o, score(o)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : null;
  }

  // A type-ahead box shows its choices after typing; click the one that matches.
  // "picked": a suggestion was clicked. "none": no list ever appeared, so the
  // typed text is the answer. "nomatch": a list appeared but nothing fitted.
  async function pickSuggestion(el, value) {
    const want = String(value).trim().toLowerCase();
    const owned = (el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
    let sawList = false;
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop -- polling: the list appears, and narrows down, a moment after typing
      await sleep(150);
      const pool = suggestionsFor(owned);
      sawList = sawList || pool.length > 0;
      // The list may still be narrowing down to what was typed; look again.
      const o = pool.length ? bestSuggestion(pool, want) : null;
      if (!o) continue;
      for (const type of CLICK) o.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      return "picked";
    }
    return sawList ? "nomatch" : "none";
  }

  // Writing one answer, by kind of field. Each returns "filled", "check" (look at it) or "blank".
  const WRITE = {
    file: (els, value, cv) => {
      if (!cv) return "blank";
      const el = els[0];
      const bytes = Uint8Array.from(atob(cv.base64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], cv.name, { type: "application/pdf" }));
      el.files = dt.files;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.files.length ? "filled" : "blank";
    },
    radio: (els, value) => {
      const hit = els.find((e) => same(optionLabel(e), value));
      if (!hit) return "blank";
      hit.click();
      return "filled";
    },
    checkbox: (els, value) => {
      const wanted = els.length === 1 ? (value === "yes" ? els : []) : els.filter((e) => [].concat(value).some((v) => same(optionLabel(e), v)));
      for (const e of wanted) if (!e.checked) e.click();
      return wanted.length ? "filled" : "blank";
    },
    select: ([el], value) => {
      const hit = [...el.options].find((o) => same(text(o), value));
      if (!hit) return "blank";
      setValue(el, hit.value);
      return "filled";
    },
    box: async ([el], value) => {
      el.focus();
      setValue(el, String(value));
      if (!isCombo(el)) return "filled";
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
      return (await pickSuggestion(el, value)) === "nomatch" ? "check" : "filled";
    },
  };
  const writerFor = (el) => (el.type === "file" || el.type === "radio" || el.type === "checkbox" ? el.type : el.tagName === "SELECT" ? "select" : "box");
  const hasValue = (v) => v !== null && v !== undefined;

  async function writeAnswer(els, a, cv) {
    const kind = writerFor(els[0]);
    if (kind !== "file" && !hasValue(a.value)) return "blank";
    try {
      return await WRITE[kind](els, a.value, cv);
    } catch {
      return "blank";
    }
  }

  // What was written, short enough for the popup list.
  function written(a, el, status, cv) {
    if (el.type === "file") return status === "filled" && cv ? cv.name : "";
    if (!hasValue(a.value)) return "";
    const v = Array.isArray(a.value) ? a.value.join(", ") : el.type === "checkbox" && a.value === "yes" ? "ticked" : String(a.value);
    return v.length > 90 ? v.slice(0, 88).trimEnd() + "…" : v;
  }

  // Green when filled; amber when it needs a look or a required field is still empty. Optional ones can stay empty.
  const outlineFor = (status, required) => (status === "filled" ? GREEN : status === "check" || required ? AMBER : "");

  // Fills one field and says how it went, for the popup's list.
  async function fillOne(a, els, cv) {
    const el = els[0];
    const label = questionFor(el, els.length > 1 ? els : undefined) || "(unlabelled field)";
    const status = await writeAnswer(els, a, cv);
    if (status === "filled") state.wrote.set(a.id, readValue(els));
    const m = state.meta.get(a.id) || {};
    const required = !!m.required;
    outline(el, outlineFor(status, required));
    return { label: (m.label || label).slice(0, 120), status, required, source: a.source || "", rule: a.rule || "", value: written(a, el, status, cv) };
  }

  // answers: [{ id, value, source }], cv: { name, base64 } | null
  async function fill(answers, cv) {
    state.filling = true;
    clearTimeout(state.timer);
    try {
      const result = [];
      for (const a of answers) {
        const els = state.marked.get(a.id);
        if (!els || !els[0].isConnected) continue;
        // eslint-disable-next-line no-await-in-loop -- one field at a time: each takes focus and a type-ahead list belongs to the box being typed in
        result.push(await fillOne(a, els, cv));
      }
      return result;
    } finally {
      state.filling = false;
    }
  }

  function banner(message, tone) {
    if (window.top !== window) return;
    let box = document.getElementById("jobpilot-banner");
    if (!box) {
      box = document.createElement("div");
      box.id = "jobpilot-banner";
      box.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;padding:12px 14px;border-radius:10px;" +
        "font:600 13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;white-space:pre-line";
      box.title = "Click to dismiss";
      box.addEventListener("click", () => box.remove());
      document.documentElement.appendChild(box);
    }
    box.style.background = tone === "bad" ? "#b42318" : tone === "good" ? "#14724a" : "#3b4cca";
    box.textContent = "JobPilot\n" + message;
  }

  JP.form = { state, hooks, collect, fill, banner };
})();
