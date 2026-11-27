// Runs inside the application page. It reads the empty form fields, and later
// writes the answers JobPilot returns. It never clicks Next, Review or Submit.
// When you press one, the answers you typed or picked yourself are sent to
// JobPilot and remembered for the next form.
// A type-ahead box (city, school) gets its matching suggestion picked.
(() => {
  if (window.__jobpilot) return;

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

  const GREEN = "2px solid #1f9d63";
  const AMBER = "2px solid #d97706";
  const SKIP_INPUT = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
  const MAX_FIELDS = 60;
  const marked = new Map();
  // id -> { label, type, options } for every field read, and id -> the value JobPilot wrote.
  const meta = new Map();
  const wrote = new Map();
  let counter = 0;
  let timer = 0;

  const text = (el) => (el ? (el.innerText || el.textContent || "") : "").replace(/\s+/g, " ").trim();
  // A label's own words, without the text of a dropdown or box nested inside it.
  const labelText = (label) => {
    if (!label.querySelector("select, textarea, input")) return text(label);
    const copy = label.cloneNode(true);
    copy.querySelectorAll("select, textarea, input, button").forEach((n) => n.remove());
    return (copy.textContent || "").replace(/\s+/g, " ").trim();
  };
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  function ownLabel(el) {
    const root = el.getRootNode();
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const byIds = ids.map((id) => text(root.getElementById ? root.getElementById(id) : null)).join(" ").trim();
    if (byIds) return byIds;
    const native = [...(el.labels || [])].map(labelText).join(" ").trim();
    if (native) return native;
    return (el.getAttribute("aria-label") || "").trim();
  }

  // The element holding one option of a group: its input and its text, however
  // the site builds it (a wrapping <label>, a sibling label, a plain <span>).
  function optionRow(m, members) {
    let row = m;
    while (row.parentElement && !members.some((o) => o !== m && row.parentElement.contains(o))) row = row.parentElement;
    return row;
  }

  // The other radios/checkboxes that share this one's name.
  function siblingsOf(el) {
    if (!el.name) return [el];
    const root = el.getRootNode();
    const all = [...(root.querySelectorAll ? root.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`) : [el])];
    return all.length ? all : [el];
  }

  const rowsOf = (members) => (members.length > 1 ? members.map((m) => optionRow(m, members)) : []);

  // The question text for a field or a group of radios/checkboxes.
  function questionFor(el, group) {
    const members = group || [el];
    const rows = rowsOf(members);
    const inOption = (c) =>
      rows.some((r) => r.contains(c)) ||
      members.some(
        (m) => c.contains(m) || [...(m.labels || [])].some((l) => l === c || l.contains(c)) || (c.closest("label") && c.closest("label").contains(m)),
      );
    const fieldset = el.closest("fieldset");
    if (fieldset && members.every((m) => fieldset.contains(m))) {
      const legend = fieldset.querySelector("legend");
      if (legend && !inOption(legend) && text(legend)) return text(legend);
    }
    const ariaGroup = el.closest('[role="group"], [role="radiogroup"]');
    if (group && ariaGroup) {
      const l = ownLabel(ariaGroup);
      if (l) return l;
    }
    if (!group) {
      const own = ownLabel(el);
      if (own) return own;
    }
    // Walk up until a container holds some text that is not the options themselves.
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (!members.every((m) => node.contains(m))) continue;
      const candidates = node.querySelectorAll('legend, label, [class*="label" i], [class*="question" i], [class*="title" i], h3, h4, p, span, div');
      for (const c of candidates) {
        if (inOption(c) || c.querySelector("input, select, textarea")) continue;
        const t = text(c);
        if (t && t.length < 400) return t;
      }
    }
    return el.getAttribute("placeholder") || el.getAttribute("name") || "";
  }

  // An option's text: its linked label, else the text in its row, else its value.
  function optionLabel(el) {
    const own = ownLabel(el);
    if (own) return own;
    const group = siblingsOf(el);
    if (group.length > 1) {
      const row = optionRow(el, group);
      if (row !== el) {
        const t = labelText(row);
        if (t) return t;
      }
    }
    return el.value || "";
  }

  // The text around a field that is not one of its options: its question, and any * marker.
  function questionBlock(members) {
    const rows = rowsOf(members);
    let node = members[0].parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (!members.every((m) => node.contains(m))) continue;
      // Holding another field means we've left this question's own area.
      if ([...node.querySelectorAll("input, select, textarea")].some((x) => !members.includes(x) && x.type !== "hidden")) return null;
      let outside = "";
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const host = t.parentElement;
        if (!host || rows.some((r) => r.contains(host)) || members.some((m) => m === host || m.contains(host))) continue;
        if (host.closest("select, option, script, style")) continue;
        outside += t.nodeValue;
        if (outside.length > 800) break;
      }
      outside = outside.replace(/\s+/g, " ").trim();
      // Too much text means this is the whole form, not one question.
      if (outside.length > 800) return null;
      if (outside) return { node, text: outside, rows };
    }
    return null;
  }

  // Whether the form says a field must be answered: the required attribute,
  // a * or ✱ by the question (LinkedIn, Lever, Greenhouse), or a "required" marker next to it.
  function isRequired(members, label) {
    if (members.some((m) => m.required || m.getAttribute("aria-required") === "true")) return true;
    const group = members[0].closest('[role="group"], [role="radiogroup"]');
    if (group && group.getAttribute("aria-required") === "true") return true;
    if (/✱|^\s*\*|\*\s*$|\(required\)|\brequired\s*$/i.test(label || "")) return true;
    const block = questionBlock(members);
    if (!block) return false;
    if (/[*✱]|\(required\)/i.test(block.text)) return true;
    const marker = [...block.node.querySelectorAll('[class*="required" i], abbr[title*="required" i]')].find(
      (x) => !/^(input|select|textarea)$/i.test(x.tagName) && !block.rows.some((r) => r.contains(x)) && !members.some((m) => x.contains(m)),
    );
    return !!marker;
  }

  // Every element matching `selector` under `root`, including inside open
  // shadow roots (LinkedIn's newer Easy Apply renders inside one).
  function deepAll(root, selector) {
    const out = [...root.querySelectorAll(selector)];
    const walk = (node) => {
      for (const el of node.querySelectorAll("*")) {
        if (el.shadowRoot) {
          out.push(...el.shadowRoot.querySelectorAll(selector));
          walk(el.shadowRoot);
        }
      }
    };
    walk(root);
    return out;
  }

  // Site search boxes and menus are not part of an application form.
  const pageChrome = (el) =>
    !!el.closest('header, nav, [role="search"], [role="banner"], [role="navigation"]') ||
    /search/i.test([el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.name, el.id].join(" "));

  const FIELD = "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select";
  const MOVE_BUTTON = /^(next|review|submit|submit application|continue|apply|save and continue)$/i;

  // The application window on the page, if one is open. Marked windows
  // (role="dialog", aria-modal, <dialog>) first; otherwise an overlay found by
  // how it looks: a fixed-position box holding form fields. LinkedIn's new
  // Easy Apply is plain <div>s with no dialog markers.
  function scope() {
    const dialogs = deepAll(document, '[role="dialog"], dialog[open], [aria-modal="true"]').filter(
      (d) => shown(d) && d.querySelector(FIELD),
    );
    if (dialogs.length) return dialogs[dialogs.length - 1];

    const overlays = new Map();
    for (const el of deepAll(document, FIELD)) {
      if (!shown(el) && !(el.labels && [...el.labels].some(shown))) continue;
      if (pageChrome(el)) continue;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const pos = getComputedStyle(node).position;
        if (pos === "fixed") {
          overlays.set(node, (overlays.get(node) || 0) + 1);
          break;
        }
      }
    }
    if (!overlays.size) return document;
    const hasMove = (n) => [...n.querySelectorAll("button, [role=button]")].some((b) => MOVE_BUTTON.test(text(b)));
    return [...overlays.entries()].sort((a, b) => Number(hasMove(b[0])) - Number(hasMove(a[0])) || b[1] - a[1])[0][0];
  }

  // The question without its required marker or a dropdown's helper text
  // ("Current location ✱No location found. Try entering…Loading").
  function cleanLabel(raw) {
    let l = String(raw || "");
    const star = l.indexOf("✱");
    if (star > 0 && l.slice(star + 1).trim()) l = l.slice(0, star);
    l = l.replace(/\bno [a-z ]{0,40} found\..*$/i, "").replace(/\s*loading\W*$/i, "");
    return l.replace(/\s*[✱*]\s*$/, "").replace(/\s*\(required\)\s*$/i, "").trim();
  }

  // A field that already has an answer: not sent to JobPilot, but watched, so
  // a change you make is saved. Its value now is the starting point.
  function watch(els, label, type, options) {
    const id = mark(els);
    meta.set(id, { label: cleanLabel(label), type, options, required: false });
    wrote.set(id, readValue(els));
  }

  // Element -> its id, so a page that grows (the next step of a form) only
  // adds the new fields.
  let known = new WeakMap();

  function mark(els) {
    const id = "jp" + ++counter;
    marked.set(id, els);
    for (const el of els) known.set(el, id);
    return id;
  }

  // Reads the form's fields. `keep`: add only fields not seen before and keep
  // the rest (suggestions as fields appear); otherwise start over (Fill).
  function collect(opts) {
    const keep = !!(opts && opts.keep);
    if (!keep) {
      marked.clear();
      meta.clear();
      wrote.clear();
      known = new WeakMap();
      clearChips();
    }
    const root = scope();
    const fields = [];
    const groups = new Map();
    let wantsCv = false;

    for (const el of deepAll(root, "input, textarea, select")) {
      if (fields.length >= MAX_FIELDS) break;
      if (el.disabled || el.readOnly || known.has(el) || pageChrome(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag;
      if (SKIP_INPUT.has(type)) continue;

      if (type === "file") {
        const label = questionFor(el);
        const hay = (label + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
        const isCv = /resume|résumé|\bcv\b|curriculum/.test(hay) || (!/cover|transcript|portfolio|photo|picture|avatar/.test(hay) && /pdf|doc|^$/.test((el.accept || "").toLowerCase()));
        if (isCv && !el.files.length) {
          wantsCv = true;
          fields.push({ id: mark([el]), label: label || "Resume / CV", type: "file" });
        }
        continue;
      }

      if (type === "radio" || type === "checkbox") {
        if (!shown(el) && !shown(el.closest("label")) && ![...(el.labels || [])].some(shown)) continue;
        const key = type + "|" + (el.name || el.id || "") + "|" + (el.form ? [...document.forms].indexOf(el.form) : "");
        if (el.name) {
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(el);
        } else {
          groups.set({}, [el]);
        }
        continue;
      }

      if (!shown(el)) continue;
      if (tag === "select") {
        const chosen = el.options[el.selectedIndex];
        const options = [...el.options].filter((o) => o.value && !o.disabled).map((o) => text(o)).filter(Boolean);
        if (!options.length) continue;
        if (chosen && chosen.value && el.selectedIndex > 0) {
          watch([el], questionFor(el), "select", options);
          continue;
        }
        const label = questionFor(el);
        fields.push({ id: mark([el]), label, type: "select", options, required: isRequired([el], label) });
        continue;
      }
      const kind = tag === "textarea" ? "textarea" : ["number", "email", "tel", "url", "date"].includes(type) ? type : "text";
      if (el.value.trim()) {
        watch([el], questionFor(el), kind);
        continue;
      }
      const label = questionFor(el);
      fields.push({
        id: mark([el]),
        label,
        type: kind,
        required: isRequired([el], label),
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      });
    }

    for (const els of groups.values()) {
      if (fields.length >= MAX_FIELDS) break;
      if (els.some((e) => known.has(e))) continue;
      const type = els[0].type;
      if (els.some((e) => e.checked)) {
        const single = type === "checkbox" && els.length === 1;
        watch(els, single ? optionLabel(els[0]) || questionFor(els[0]) : questionFor(els[0], els), type, single ? undefined : els.map(optionLabel));
        continue;
      }
      if (type === "checkbox" && els.length === 1) {
        const label = optionLabel(els[0]) || questionFor(els[0]);
        fields.push({ id: mark(els), label, type: "checkbox", required: isRequired(els, label) });
      } else {
        const label = questionFor(els[0], els);
        fields.push({ id: mark(els), label, type, options: els.map(optionLabel), required: isRequired(els, label) });
      }
    }
    for (const f of fields) {
      if (f.type === "file") f.required = isRequired(marked.get(f.id), f.label);
      f.label = cleanLabel(f.label);
      meta.set(f.id, { label: f.label, type: f.type, options: f.options, required: !!f.required });
    }
    armLearning();
    return { fields, wantsCv };
  }

  function setValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    // Frameworks such as React only notice a change made through the native setter.
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  }

  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const outline = (el, style) => {
    const target = el.type === "radio" || el.type === "checkbox" || !shown(el) ? el.closest("label") || el.parentElement || el : el;
    target.style.outline = style;
    target.style.outlineOffset = "2px";
  };
  const isCombo = (el) =>
    el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete") || el.getAttribute("aria-haspopup") === "listbox" || el.hasAttribute("list");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A type-ahead box shows its choices after typing; click the one that matches.
  // "picked": a suggestion was clicked. "none": no list ever appeared, so the
  // typed text is the answer. "nomatch": a list appeared but nothing fitted.
  async function pickSuggestion(el, value) {
    const want = String(value).trim().toLowerCase();
    const owned = (el.getAttribute("aria-controls") || el.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean);
    let sawList = false;
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      const roots = owned.map((id) => document.getElementById(id)).filter(Boolean);
      const pool = [
        ...roots.flatMap((r) => [...r.querySelectorAll('[role="option"], li')]),
        ...document.querySelectorAll('[role="listbox"] [role="option"], [role="option"], .pac-item, [class*="option" i][id*="option" i], [class*="suggestion" i] li, [class*="menu" i] [class*="option" i]'),
      ].filter((o) => shown(o) && text(o));
      if (!pool.length) continue;
      sawList = true;
      const score = (o) => {
        const t = text(o).toLowerCase();
        return t === want ? 3 : t.startsWith(want) ? 2 : t.includes(want) ? 1 : 0;
      };
      const best = pool.map((o) => [o, score(o)]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1])[0];
      // The list may still be narrowing down to what was typed; look again.
      if (!best) continue;
      const o = best[0];
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        o.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      return "picked";
    }
    return sawList ? "nomatch" : "none";
  }

  // answers: [{ id, value, source }], cv: { name, base64 } | null
  let filling = false;
  async function fill(answers, cv) {
    filling = true;
    clearTimeout(timer);
    try {
      return await fillAll(answers, cv);
    } finally {
      filling = false;
    }
  }

  async function fillAll(answers, cv) {
    const result = [];
    for (const a of answers) {
      const els = marked.get(a.id);
      if (!els || !els[0].isConnected) continue;
      const el = els[0];
      const label = questionFor(el, els.length > 1 ? els : undefined) || "(unlabelled field)";
      let status = "blank";
      try {
        if (el.type === "file") {
          if (cv) {
            const bytes = Uint8Array.from(atob(cv.base64), (c) => c.charCodeAt(0));
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], cv.name, { type: "application/pdf" }));
            el.files = dt.files;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            status = el.files.length ? "filled" : "blank";
          }
        } else if (a.value !== null && a.value !== undefined) {
          if (el.type === "radio") {
            const hit = els.find((e) => same(optionLabel(e), a.value));
            if (hit) { hit.click(); status = "filled"; }
          } else if (el.type === "checkbox") {
            const wanted = els.length === 1 ? (a.value === "yes" ? els : []) : els.filter((e) => [].concat(a.value).some((v) => same(optionLabel(e), v)));
            for (const e of wanted) if (!e.checked) e.click();
            if (wanted.length) status = "filled";
          } else if (el.tagName === "SELECT") {
            const hit = [...el.options].find((o) => same(text(o), a.value));
            if (hit) { setValue(el, hit.value); status = "filled"; }
          } else {
            el.focus();
            setValue(el, String(a.value));
            if (isCombo(el)) {
              el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
              status = (await pickSuggestion(el, a.value)) === "nomatch" ? "check" : "filled";
            } else {
              status = "filled";
            }
          }
        }
      } catch {
        status = "blank";
      }
      if (status === "filled") wrote.set(a.id, readValue(els));
      const required = !!(meta.get(a.id) || {}).required;
      // Only a required field left empty is flagged; optional ones can stay empty.
      outline(el, status === "filled" ? GREEN : status === "check" || required ? AMBER : "");
      const name = ((meta.get(a.id) || {}).label || label).slice(0, 120);
      result.push({ label: name, status, required, source: a.source || "", rule: a.rule || "", value: written(a, el, status, cv) });
    }
    return result;
  }

  // The value a field holds right now, in the same shape answers use.
  function readValue(els) {
    const el = els[0];
    if (!el || !el.isConnected || el.type === "file") return null;
    if (el.type === "radio") {
      const on = els.find((e) => e.checked);
      return on ? optionLabel(on) : null;
    }
    if (el.type === "checkbox") {
      if (els.length === 1) return el.checked ? "yes" : null;
      const on = els.filter((e) => e.checked).map(optionLabel);
      return on.length ? on : null;
    }
    if (el.tagName === "SELECT") {
      const o = el.options[el.selectedIndex];
      return o && o.value && el.selectedIndex > 0 ? text(o) : null;
    }
    if (el.value.trim()) return el.value.trim();
    return isCombo(el) ? shownChoice(el) : null;
  }

  // The choice a custom dropdown shows (react-select, Select2, Workday) while its text box stays empty.
  function shownChoice(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const hit = node.querySelector(
        '[class*="singleValue"], [class*="single-value"], .select2-selection__rendered, [class*="selected-value" i], [class*="selectedValue"], [data-automation-id="selectedItem"]',
      );
      const t = hit && text(hit);
      if (t && !/^(select|choose|search)\b|\.\.\.$|…$/i.test(t)) return t;
    }
    return null;
  }

  const norm = (v) => (Array.isArray(v) ? [...v].sort().join("|") : String(v ?? "")).trim().toLowerCase();

  // Answers you gave yourself: fields JobPilot left, or ones you changed after it filled them.
  function pending() {
    const items = [];
    for (const [id, els] of marked) {
      const m = meta.get(id);
      if (!m || m.type === "file") continue;
      // Still typing: saved when you leave the box.
      if (document.activeElement === els[0] && /^(text|textarea|email|tel|url|number|date)$/.test(m.type)) continue;
      const now = readValue(els);
      if (now === null) continue;
      if (wrote.has(id) && norm(wrote.get(id)) === norm(now)) continue;
      items.push({ id, label: m.label, type: m.type, options: m.options, value: now });
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
    const before = new Map(items.map((it) => [it.id, wrote.get(it.id)]));
    for (const it of items) wrote.set(it.id, it.value);
    const payload = items.map((it) => ({ label: it.label, type: it.type, options: it.options, value: it.value }));
    chrome.runtime
      .sendMessage({ type: "learn", items: payload })
      .then((reply) => {
        if (!reply || reply.error) {
          // Try again in 30 s rather than on every check.
          for (const [id, v] of before) {
            if (v === undefined) wrote.delete(id);
            else wrote.set(id, v);
          }
          pausedUntil = Date.now() + 30_000;
          return toast(`Could not save your answer: ${(reply && reply.error) || "the extension did not answer"}`, true);
        }
        if (reply.saved && reply.saved.length) {
          const short = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
          toast("Saved to JobPilot:\n" + reply.saved.map((x) => `${short(x.question, 70)} → ${short([].concat(x.answer).join(", "), 60)}`).join("\n"));
        }
      })
      .catch(() => {});
    return items.length;
  }

  const MOVE_ON = /submit|apply|send|next|continue|review|save|finish|done/i;
  let armed = false;
  let ticker = 0;
  let pausedUntil = 0;
  // Your answers are saved a moment after you give them: any click, typing or
  // change schedules a check, and a light check runs every 2 s for widgets
  // that change values without telling anyone. Submit / Next and leaving the
  // page save too.
  function armLearning() {
    if (armed) return;
    armed = true;
    const soon = () => {
      if (filling) return;
      clearTimeout(timer);
      timer = setTimeout(flush, 1200);
    };
    for (const type of ["change", "input", "click", "focusout"]) document.addEventListener(type, soon, true);
    document.addEventListener("submit", () => !filling && flush(), true);
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], input[type="button"], [role="button"], a');
        if (!filling && b && MOVE_ON.test(text(b) || b.value || b.getAttribute("aria-label") || "")) flush();
      },
      true,
    );
    window.addEventListener("pagehide", () => !filling && flush());
    ticker = setInterval(() => !filling && flush(), 2000);
  }

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

  // What was written, short enough for the popup list.
  function written(a, el, status, cv) {
    if (el.type === "file") return status === "filled" && cv ? cv.name : "";
    if (a.value === null || a.value === undefined) return "";
    const v = Array.isArray(a.value) ? a.value.join(", ") : el.type === "checkbox" && a.value === "yes" ? "ticked" : String(a.value);
    return v.length > 90 ? v.slice(0, 88).trimEnd() + "…" : v;
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


  // ---------- answer suggestions under fields, as they appear ----------

  // suggest: "Everywhere" in the popup. pageOn: "This page" (until the page is left).
  const prefs = { suggest: false, autoFill: false, showAll: false };
  let pageOn = false;
  const suggesting = () => prefs.suggest || pageOn;
  // Suggestions for text boxes and dropdowns, shown in a list when you click into the field.
  const offers = new Map(); // field id -> answer | null
  const chips = new Map(); // field id -> { box, els, answer, state }
  let overlay = null;
  let looping = false;
  let lastScan = 0;
  let scanning = false;

  const SOURCE_NAME = { profile: "CV", bank: "answer bank", saved: "yours", learned: "record", ai: "AI" };
  const SOURCE_COLOR = { profile: "#475467", bank: "#475467", saved: "#0d9488", learned: "#2563eb", ai: "#8b5cf6" };

  function overlayRoot() {
    if (overlay && overlay.host.isConnected) return overlay;
    const host = document.createElement("div");
    host.id = "jobpilot-suggestions";
    host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
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
    document.documentElement.appendChild(host);
    overlay = { host, shadow };
    return overlay;
  }

  // Where a chip sits: under the field, or under the question for a group of options.
  function anchorOf(els) {
    if (els.length > 1) {
      const block = questionBlock(els);
      if (block) return block.node;
    }
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

  function renderChip(id) {
    const c = chips.get(id);
    if (!c) return;
    const box = c.box;
    box.className = "chip" + (c.state === "done" ? " done" : c.state === "error" ? " bad" : "");
    box.replaceChildren();
    const add = (tag, cls, txt) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt !== undefined) e.textContent = txt;
      box.append(e);
      return e;
    };
    add("span", "brand", "JobPilot");
    if (c.state === "done") {
      add("span", "ans", "✓ Filled");
      return;
    }
    if (c.state === "error") {
      add("span", "ans", c.error);
    } else if (c.state === "asking") {
      add("span", "ans", "Asking AI…");
    } else if (c.answer) {
      const tag = add("span", "tag", SOURCE_NAME[c.answer.source] || c.answer.source);
      tag.style.background = SOURCE_COLOR[c.answer.source] || "#475467";
      const shown_ = Array.isArray(c.answer.value) ? c.answer.value.join(", ") : c.answer.value === "yes" && c.els[0].type === "checkbox" ? "tick it" : String(c.answer.value);
      const ans = add("span", "ans", shown_);
      ans.title = shown_;
      add("button", "", "Fill");
    } else {
      add("span", "ans", "No saved answer");
      add("button", "", "Ask AI");
    }
    const x = add("button", "x", "✕");
    x.title = "Hide this suggestion";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      dropChip(id);
    });
  }

  function showChip(id, answer) {
    const els = marked.get(id);
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
    const [r] = await fill([{ id, value: answer.value, source: answer.source }], null);
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

  async function chipClicked(id) {
    const c = chips.get(id);
    if (!c || c.state === "asking" || c.state === "done") return;
    if (c.answer) return applyAnswer(id, c.answer);
    // No saved answer: one small AI call for just this field. Its answer is remembered.
    const m = meta.get(id);
    c.state = "asking";
    renderChip(id);
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "askAi",
        url: location.href,
        fields: [{ id, label: m.label, type: m.type, options: m.options, required: m.required }],
      });
      const a = reply && reply.answers && reply.answers.find((x) => x.value !== null && x.value !== undefined);
      if (!reply || reply.error || !a) {
        c.state = "error";
        c.error = (reply && reply.error) || "The AI had no answer. Fill it yourself; it will be saved.";
      } else {
        c.answer = a;
        c.state = "ready";
      }
    } catch {
      c.state = "error";
      c.error = "JobPilot did not answer. Reload this page.";
    }
    renderChip(id);
  }

  // Keeps every chip under its field while the page or a dialog scrolls; drops
  // chips whose field disappeared or got a value.
  function follow() {
    if (looping) return;
    looping = true;
    const step = () => {
      for (const [id, c] of chips) {
        const anchor = anchorOf(c.els);
        if (!c.els[0].isConnected || !anchor.isConnected) {
          dropChip(id);
          continue;
        }
        if (c.state !== "done" && readValue(c.els) !== null) {
          dropChip(id);
          continue;
        }
        const r = anchor.getBoundingClientRect();
        const hidden = !r.width && !r.height;
        c.box.style.display = hidden ? "none" : "flex";
        c.box.style.left = Math.max(4, r.left) + "px";
        c.box.style.top = Math.min(window.innerHeight - 30, r.bottom + 4) + "px";
      }
      if (chips.size) requestAnimationFrame(step);
      else looping = false;
    };
    requestAnimationFrame(step);
  }

  // Looks for new empty fields and asks JobPilot what it already knows about them.
  // `fresh`: read the whole form again (suggestions were just switched on), not only new fields.
  async function suggestNew(fresh) {
    if (filling || scanning || !alive()) return;
    if (!fresh && Date.now() - lastScan < 700) return;
    // On LinkedIn, application questions only appear in the Easy Apply dialog;
    // elsewhere (feed, search) the page's own boxes are left alone.
    if (/(^|\.)linkedin\.com$/.test(location.hostname) && scope() === document) return;
    lastScan = Date.now();
    scanning = true;
    try {
      // Fields are always read, so answers you give yourself are saved even with suggestions off.
      const fields = collect(fresh === true ? undefined : { keep: true }).fields.filter((f) => f.type !== "file");
      if (!fields.length || !suggesting()) return;
      const reply = await chrome.runtime.sendMessage({ type: "suggest", url: location.href, fields });
      if (!reply || reply.error) return;
      const byId = new Map((reply.answers || []).map((a) => [a.id, a]));
      for (const f of fields) {
        const found = byId.get(f.id) || null;
        const a = found && found.value !== null ? found : null;
        const box = !(f.type === "radio" || f.type === "checkbox");
        if (a && prefs.autoFill) {
          showChip(f.id, a);
          await applyAnswer(f.id, a);
        } else if (a && (!box || prefs.showAll)) {
          // Options have no box to click into, so a known answer gets a card under the question.
          showChip(f.id, a);
        } else if (box) {
          // Text boxes and dropdowns: a list when you click in (Ask AI is there even with no answer).
          offerOnFocus(f.id, found);
        }
        // An option question JobPilot knows nothing about gets nothing, so the page stays clean.
      }
    } catch {
      // The extension was reloaded or JobPilot is not running; try again on the next change.
    } finally {
      scanning = false;
    }
  }


  // ---------- the list that opens when you click into a field (like Chrome's autofill) ----------

  let menu = null; // { id, el, box, items, on, state, error }

  function offerOnFocus(id, found) {
    const els = marked.get(id);
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
    if (document.activeElement === el || (el.getRootNode().activeElement === el)) openMenu(id);
  }

  function menuItems(id) {
    const found = offers.get(id);
    const items = [];
    if (found && found.value !== null && found.value !== undefined) items.push({ value: found.value, source: found.source });
    for (const alt of (found && found.alternatives) || []) items.push(alt);
    items.push({ ai: true });
    return items;
  }

  function openMenu(id) {
    if (!suggesting() || filling) return;
    const els = marked.get(id);
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

  function drawMenu() {
    if (!menu) return;
    const { box } = menu;
    box.replaceChildren();
    const add = (cls, txt) => {
      const e = document.createElement("div");
      e.className = cls;
      if (txt !== undefined) e.textContent = txt;
      box.append(e);
      return e;
    };
    add("head", "JobPilot");
    if (menu.state === "asking") {
      add("note", "Asking AI…").style.color = "#c4b5fd";
      return;
    }
    menu.items.forEach((it, i) => {
      const row = add("item" + (i === menu.on ? " on" : "") + (it.ai ? " ai" : ""));
      if (it.ai) {
        row.textContent = "✨ Ask AI for this answer";
      } else {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = SOURCE_NAME[it.source] || it.source;
        tag.style.background = SOURCE_COLOR[it.source] || "#475467";
        const ans = document.createElement("span");
        ans.className = "ans";
        ans.textContent = Array.isArray(it.value) ? it.value.join(", ") : String(it.value);
        ans.title = ans.textContent;
        row.append(tag, ans);
      }
      row.addEventListener("click", () => pickItem(i));
    });
    if (menu.state === "error") add("note", menu.error);
  }

  async function pickItem(i) {
    if (!menu) return;
    const it = menu.items[i];
    const id = menu.id;
    if (!it) return;
    if (!it.ai) {
      closeMenu();
      await fill([{ id, value: it.value, source: it.source }], null);
      return;
    }
    // One small AI call for this field; the answer is remembered for next time.
    const m = meta.get(id);
    menu.state = "asking";
    menu.keep = true;
    drawMenu();
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "askAi",
        url: location.href,
        fields: [{ id, label: m.label, type: m.type, options: m.options, required: m.required }],
      });
      const a = reply && reply.answers && reply.answers.find((x) => x.value !== null && x.value !== undefined);
      if (!menu || menu.id !== id) return;
      menu.keep = false;
      if (!reply || reply.error || !a) {
        menu.state = "error";
        menu.error = (reply && reply.error) || "The AI had no answer. Type it yourself; it will be saved.";
      } else {
        offers.set(id, { ...a, alternatives: [] });
        menu.items = [{ value: a.value, source: "ai" }, { ai: true }];
        menu.on = 0;
        menu.state = "ready";
      }
    } catch {
      if (menu) {
        menu.keep = false;
        menu.state = "error";
        menu.error = "JobPilot did not answer. Reload this page.";
      }
    }
    drawMenu();
  }

  // ↑ ↓ to move, Enter to fill, Esc to close — like Chrome's own list.
  function menuKeys(e) {
    if (!menu || e.currentTarget !== menu.el || menu.state === "asking") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      menu.on = (menu.on + (e.key === "ArrowDown" ? 1 : -1) + menu.items.length) % menu.items.length;
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
      const els = marked.get(menu.id);
      if (!menu.el.isConnected || !els || (readValue(els) !== null && menu.state !== "asking")) return closeMenu();
      const r = menu.el.getBoundingClientRect();
      const h = menu.box.offsetHeight || 80;
      const top = r.top - h - 6 >= 0 ? r.top - h - 6 : r.bottom + 6;
      menu.box.style.left = Math.max(4, r.left) + "px";
      menu.box.style.top = top + "px";
      menu.box.style.width = Math.min(560, Math.max(260, r.width)) + "px";
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let assisting = false;
  async function startAssist() {
    if (assisting || window.top !== window && !document.querySelector("input, textarea, select")) return;
    assisting = true;
    try {
      Object.assign(prefs, await chrome.storage.local.get({ suggest: false, autoFill: false, showAll: false }));
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const was = suggesting();
        if (changes.suggest) prefs.suggest = !!changes.suggest.newValue;
        if (changes.autoFill) prefs.autoFill = !!changes.autoFill.newValue;
        if (changes.showAll) prefs.showAll = !!changes.showAll.newValue;
        if (was !== suggesting()) applyMode();
      });
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

  // Suggestions were switched on or off: show them for the whole form, or take them all away.
  function applyMode() {
    if (suggesting()) {
      suggestNew(true);
    } else {
      clearChips();
      closeMenu();
      offers.clear();
    }
  }

  // "This page" in the popup: suggestions on this tab until the page is left.
  function setPage(on) {
    const was = suggesting();
    pageOn = !!on;
    if (was !== suggesting()) applyMode();
    return watching();
  }

  // For the popup: what is switched on, and how many form fields are seen.
  const watching = () => ({
    on: assisting && suggesting(),
    mode: prefs.suggest ? "everywhere" : pageOn ? "page" : "off",
    fields: marked.size,
    inWindow: scope() !== document,
  });

  window.__jobpilot = { collect, fill, banner, flush, suggestNew, watching, setPage };
  startAssist();
})();
