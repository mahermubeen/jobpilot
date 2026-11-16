// Runs inside the application page. It reads the empty form fields, and later
// writes the answers JobPilot returns. It never clicks Next, Review or Submit.
(() => {
  if (window.__jobpilot) return;

  const GREEN = "2px solid #1f9d63";
  const AMBER = "2px solid #d97706";
  const SKIP_INPUT = new Set(["hidden", "submit", "button", "reset", "image", "password", "search", "range", "color"]);
  const MAX_FIELDS = 60;
  const marked = new Map();
  let counter = 0;

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

  // The question text for a field or a group of radios/checkboxes.
  function questionFor(el, group) {
    const members = group || [el];
    const fieldset = el.closest("fieldset");
    if (fieldset && members.every((m) => fieldset.contains(m))) {
      const legend = text(fieldset.querySelector("legend"));
      if (legend) return legend;
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
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      if (!members.every((m) => node.contains(m))) continue;
      const candidates = node.querySelectorAll('legend, label, [class*="label" i], [class*="question" i], [class*="title" i], h3, h4, p, span');
      for (const c of candidates) {
        if (members.some((m) => c.contains(m) || (m.labels && [...m.labels].includes(c)))) continue;
        const t = text(c);
        if (t && t.length < 400) return t;
      }
    }
    return el.getAttribute("placeholder") || el.getAttribute("name") || "";
  }

  const optionLabel = (el) => ownLabel(el) || el.value || "";

  function scope() {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open], [aria-modal="true"]')].filter(
      (d) => shown(d) && d.querySelector("input, textarea, select"),
    );
    return dialogs.length ? dialogs[dialogs.length - 1] : document;
  }

  function mark(els) {
    const id = "jp" + ++counter;
    marked.set(id, els);
    return id;
  }

  function collect() {
    marked.clear();
    const root = scope();
    const fields = [];
    const groups = new Map();
    let wantsCv = false;

    for (const el of root.querySelectorAll("input, textarea, select")) {
      if (fields.length >= MAX_FIELDS) break;
      if (el.disabled || el.readOnly) continue;
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
        if (chosen && chosen.value && el.selectedIndex > 0) continue;
        const options = [...el.options].filter((o) => o.value && !o.disabled).map((o) => text(o)).filter(Boolean);
        if (!options.length) continue;
        fields.push({ id: mark([el]), label: questionFor(el), type: "select", options, required: el.required });
        continue;
      }
      if (el.value.trim()) continue;
      const kind = tag === "textarea" ? "textarea" : ["number", "email", "tel", "url", "date"].includes(type) ? type : "text";
      fields.push({
        id: mark([el]),
        label: questionFor(el),
        type: kind,
        required: el.required || el.getAttribute("aria-required") === "true",
        maxLength: el.maxLength > 0 ? el.maxLength : undefined,
      });
    }

    for (const els of groups.values()) {
      if (fields.length >= MAX_FIELDS) break;
      if (els.some((e) => e.checked)) continue;
      const type = els[0].type;
      if (type === "checkbox" && els.length === 1) {
        fields.push({ id: mark(els), label: optionLabel(els[0]) || questionFor(els[0]), type: "checkbox", required: els[0].required });
      } else {
        fields.push({
          id: mark(els),
          label: questionFor(els[0], els),
          type,
          options: els.map(optionLabel),
          required: els.some((e) => e.required),
        });
      }
    }
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

  // answers: [{ id, value }], cv: { name, base64 } | null
  function fill(answers, cv) {
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
            // Type-ahead boxes need a choice picked from their list by hand.
            status = isCombo(el) ? "check" : "filled";
          }
        }
      } catch {
        status = "blank";
      }
      outline(el, status === "filled" ? GREEN : AMBER);
      result.push({ label: label.slice(0, 120), status });
    }
    return result;
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

  window.__jobpilot = { collect, fill, banner };
})();
