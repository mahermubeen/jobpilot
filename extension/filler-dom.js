// Page script 1 of 5 (see manifest.json): reading the page. Finds a field's
// question, its options, whether it is required and what it holds now, and
// the application window the form sits in. Nothing here changes the page
// except setValue, which writes one value the way a person typing would.
(() => {
  const JP = (window.__jobpilotLib = window.__jobpilotLib || {});
  if (JP.dom) return;

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

  // Whether `c` is part of an option (its row, its label, or something holding it) rather than the question.
  const inOptionOf = (members, rows) => (c) =>
    rows.some((r) => r.contains(c)) ||
    members.some((m) => c.contains(m) || [...(m.labels || [])].some((l) => l === c || l.contains(c)) || (c.closest("label") && c.closest("label").contains(m)));

  // A <fieldset>'s <legend>, when the fieldset holds every member and the legend is not an option.
  function legendQuestion(el, members, inOption) {
    const fieldset = el.closest("fieldset");
    if (!fieldset || !members.every((m) => fieldset.contains(m))) return "";
    const legend = fieldset.querySelector("legend");
    return legend && !inOption(legend) ? text(legend) : "";
  }

  const QUESTION_TEXT = 'legend, label, [class*="label" i], [class*="question" i], [class*="title" i], h3, h4, p, span, div';

  // The first piece of text in `node` that is not an option and holds no field.
  function questionIn(node, inOption) {
    for (const c of node.querySelectorAll(QUESTION_TEXT)) {
      if (inOption(c) || c.querySelector("input, select, textarea")) continue;
      const t = text(c);
      if (t && t.length < 400) return t;
    }
    return "";
  }

  // Walk up (at most 8 levels) until a container holds some text that is not the options themselves.
  function nearbyQuestion(el, members, inOption) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      const t = members.every((m) => node.contains(m)) ? questionIn(node, inOption) : "";
      if (t) return t;
    }
    return "";
  }

  // A group's role="group" label, or a single field's own label.
  function labelledQuestion(el, group) {
    if (!group) return ownLabel(el);
    const ariaGroup = el.closest('[role="group"], [role="radiogroup"]');
    return ariaGroup ? ownLabel(ariaGroup) : "";
  }

  // The question text for a field or a group of radios/checkboxes.
  function questionFor(el, group) {
    const members = group || [el];
    const inOption = inOptionOf(members, rowsOf(members));
    return (
      legendQuestion(el, members, inOption) ||
      labelledQuestion(el, group) ||
      nearbyQuestion(el, members, inOption) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      ""
    );
  }

  // An option's text: its linked label, else the text in its row, else its value.
  function optionLabel(el) {
    const own = ownLabel(el);
    if (own) return own;
    const group = siblingsOf(el);
    const row = group.length > 1 ? optionRow(el, group) : el;
    return (row !== el && labelText(row)) || el.value || "";
  }

  // The text in `node` outside the options and fields themselves, stopping a little past 800 characters.
  function textOutside(node, members, rows) {
    let outside = "";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const isOption = (host) => !host || rows.some((r) => r.contains(host)) || members.some((m) => m === host || m.contains(host));
    for (let t = walker.nextNode(); t && outside.length <= 800; t = walker.nextNode()) {
      const host = t.parentElement;
      if (!isOption(host) && !host.closest("select, option, script, style")) outside += t.nodeValue;
    }
    return outside.replace(/\s+/g, " ").trim();
  }

  // The text around a field that is not one of its options: its question, and any * marker.
  function questionBlock(members) {
    const rows = rowsOf(members);
    const own = new Set(members);
    let node = members[0].parentElement;
    for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
      if (!members.every((m) => node.contains(m))) continue;
      // Holding another field means we've left this question's own area.
      if ([...node.querySelectorAll("input, select, textarea")].some((x) => !own.has(x) && x.type !== "hidden")) return null;
      const outside = textOutside(node, members, rows);
      // Too much text means this is the whole form, not one question.
      if (outside.length > 800) return null;
      if (outside) return { node, text: outside, rows };
    }
    return null;
  }

  // A "required" marker by the question that is not a field, an option or something holding the field.
  function hasRequiredMarker(block, members) {
    return [...block.node.querySelectorAll('[class*="required" i], abbr[title*="required" i]')].some(
      (x) => !/^(input|select|textarea)$/i.test(x.tagName) && !block.rows.some((r) => r.contains(x)) && !members.some((m) => x.contains(m)),
    );
  }

  const REQUIRED_LABEL = /✱|^\s*\*|\*\s*$|\(required\)|\brequired\s*$/i;

  // Whether the form says a field must be answered: the required attribute,
  // a * or ✱ by the question (LinkedIn, Lever, Greenhouse), or a "required" marker next to it.
  function isRequired(members, label) {
    if (members.some((m) => m.required || m.getAttribute("aria-required") === "true")) return true;
    const group = members[0].closest('[role="group"], [role="radiogroup"]');
    if (group && group.getAttribute("aria-required") === "true") return true;
    if (REQUIRED_LABEL.test(label || "")) return true;
    const block = questionBlock(members);
    if (!block) return false;
    return /[*✱]|\(required\)/i.test(block.text) || hasRequiredMarker(block, members);
  }

  // Every element matching `selector` under `root`, including inside open
  // shadow roots (LinkedIn's newer Easy Apply renders inside one).
  function deepAll(root, selector) {
    const out = [...root.querySelectorAll(selector)];
    const walk = (node) => {
      for (const el of node.querySelectorAll("*")) {
        if (!el.shadowRoot) continue;
        out.push(...el.shadowRoot.querySelectorAll(selector));
        walk(el.shadowRoot);
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

  const fixedAncestor = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (getComputedStyle(node).position === "fixed") return node;
    }
    return null;
  };
  const visibleField = (el) => (shown(el) || (el.labels && [...el.labels].some(shown))) && !pageChrome(el);

  // Fixed-position boxes holding form fields, with how many fields each holds.
  function overlayCounts() {
    const overlays = new Map();
    for (const el of deepAll(document, FIELD)) {
      const node = visibleField(el) && fixedAncestor(el);
      if (node) overlays.set(node, (overlays.get(node) || 0) + 1);
    }
    return overlays;
  }

  // The application window on the page, if one is open. Marked windows
  // (role="dialog", aria-modal, <dialog>) first; otherwise an overlay found by
  // how it looks: a fixed-position box holding form fields. LinkedIn's new
  // Easy Apply is plain <div>s with no dialog markers.
  function scope() {
    const dialogs = deepAll(document, '[role="dialog"], dialog[open], [aria-modal="true"]').filter((d) => shown(d) && d.querySelector(FIELD));
    if (dialogs.length) return dialogs[dialogs.length - 1];
    const overlays = overlayCounts();
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

  const isCombo = (el) =>
    el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete") || el.getAttribute("aria-haspopup") === "listbox" || el.hasAttribute("list");

  const CHOICE = '[class*="singleValue"], [class*="single-value"], .select2-selection__rendered, [class*="selected-value" i], [class*="selectedValue"], [data-automation-id="selectedItem"]';
  const PLACEHOLDER_CHOICE = /^(select|choose|search)\b|\.\.\.$|…$/i;

  // The choice a custom dropdown shows (react-select, Select2, Workday) while its text box stays empty.
  function shownChoice(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const hit = node.querySelector(CHOICE);
      const t = hit && text(hit);
      if (t && !PLACEHOLDER_CHOICE.test(t)) return t;
    }
    return null;
  }

  // The value a field holds right now, in the same shape answers use, by kind of field.
  const READERS = {
    radio: (els) => {
      const on = els.find((e) => e.checked);
      return on ? optionLabel(on) : null;
    },
    checkbox: (els) => {
      if (els.length === 1) return els[0].checked ? "yes" : null;
      const on = els.filter((e) => e.checked).map(optionLabel);
      return on.length ? on : null;
    },
    select: ([el]) => {
      const o = el.options[el.selectedIndex];
      return o && o.value && el.selectedIndex > 0 ? text(o) : null;
    },
    box: ([el]) => {
      if (el.value.trim()) return el.value.trim();
      return isCombo(el) ? shownChoice(el) : null;
    },
  };
  const readerFor = (el) => (el.type === "radio" || el.type === "checkbox" ? el.type : el.tagName === "SELECT" ? "select" : "box");

  function readValue(els) {
    const el = els[0];
    if (!el || !el.isConnected || el.type === "file") return null;
    return READERS[readerFor(el)](els);
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

  JP.dom = {
    text, labelText, shown, ownLabel, optionRow, siblingsOf, rowsOf, questionFor, optionLabel, questionBlock, isRequired,
    deepAll, pageChrome, scope, cleanLabel, isCombo, readValue, setValue, same, FIELD,
  };
})();
