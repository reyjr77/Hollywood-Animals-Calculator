// Fork addition (reyjr77): the app layout around Quick Mode.
// - Results are always live (a sticky panel on wide screens), so there is no Calculate step.
// - Step 2 is a switch between picking story elements by hand and the script generator.
// - The unlocked-tags checklist opens in a side sheet.
// - Ctrl+K or / jumps to the tag search in the header; what the search did shows as a toast.
// Loaded last. It wraps a few upstream functions by name instead of editing their files.

const TAB_KEY = "hollywood_animal_tab";
const WIDE_LAYOUT = window.matchMedia("(min-width: 1100px)");
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

function ScrollBehavior() {
  return REDUCED_MOTION.matches ? "auto" : "smooth";
}

// ---------- always-live results ----------
// Upstream hides the results until the first Calculate press. With the results beside the inputs that step only
// gets in the way, so the results section is always shown and starts with a checklist of what is still needed.

const UpstreamRevealResults = RevealResults;
RevealResults = function () {
  UpstreamRevealResults(true);
};

function UpdateReadyList() {
  const list = $("readyList");
  if (!list || !isReady) return;
  const items = [
    { label: "Pick a genre", done: genreEntries.some((entry) => entry.tag_key), target: "genre-0", tab: null },
    { label: "Pick a setting", done: Boolean(setting.value), target: "sel-setting", tab: "build" },
    { label: "Pick a protagonist", done: Boolean(protagonist.value), target: "sel-protagonist", tab: "build" }
  ];
  list.textContent = "";
  for (const item of items) {
    const row = MakeEl("li");
    const button = MakeEl("button", "ready-item" + (item.done ? " is-done" : ""));
    button.type = "button";
    const mark = MakeEl("span", "ready-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.innerHTML = item.done ? '<svg viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : "";
    button.appendChild(mark);
    button.appendChild(MakeEl("span", "ready-label", item.label));
    button.appendChild(MakeEl("span", "ready-state", item.done ? "Done" : "Go"));
    button.setAttribute("aria-label", item.label + (item.done ? ", done" : ", not done yet"));
    button.addEventListener("click", () => {
      if (item.tab) ShowTab(item.tab);
      const target = $(item.target);
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: ScrollBehavior() });
      target.focus({ preventScroll: true });
    });
    row.appendChild(button);
    list.appendChild(row);
  }
  const missing = items.some((item) => !item.done);
  $("results").classList.toggle("has-checklist", missing && genreEntries.every((entry) => entry.tag_key || genreEntries.length === 1));
}

// UpdateFitHints runs at the start of every recalculation (see QuickModeUI.js), so the checklist rides along.
const ForkUpdateFitHints = UpdateFitHints;
UpdateFitHints = function () {
  ForkUpdateFitHints();
  UpdateReadyList();
  UpdateStoryAvailNote();
};

// ---------- step 2: pick by hand, or generate ----------

function ShowTab(name, focusTab) {
  const build = name !== "generate";
  const tabs = [["tabBuild", "panelBuild", build], ["tabGenerate", "panelGenerate", !build]];
  for (const [tabId, panelId, on] of tabs) {
    const tab = $(tabId);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(panelId).hidden = !on;
  }
  $("tabBuild").parentElement.dataset.active = build ? "0" : "1";
  WriteStored(TAB_KEY, build ? "build" : "generate");
  if (focusTab) $(build ? "tabBuild" : "tabGenerate").focus();
}

function InitTabs() {
  ShowTab(ReadStored(TAB_KEY, "build"));
  for (const id of ["tabBuild", "tabGenerate"]) {
    $(id).addEventListener("click", () => ShowTab(id === "tabBuild" ? "build" : "generate"));
  }
  $("tabBuild").parentElement.addEventListener("keydown", (event) => {
    const keys = { ArrowLeft: "build", ArrowRight: "generate", Home: "build", End: "generate" };
    if (!keys[event.key]) return;
    event.preventDefault();
    ShowTab(keys[event.key], true);
  });
}

// A search pick for a story slot goes to the hand-picked view, and the field it filled is brought into view.
const UpstreamPlaceTag = PlaceTag;
PlaceTag = function (tag) {
  if (tag.category !== "Genre") ShowTab("build");
  const message = UpstreamPlaceTag(tag);
  window.requestAnimationFrame(() => {
    const flashing = [...document.querySelectorAll(".flash")].find((node) => {
      const select = node.querySelector("select");
      return select && select.getAnimations && select.getAnimations().length > 0;
    });
    if (flashing) flashing.scrollIntoView({ block: "nearest", behavior: ScrollBehavior() });
  });
  return message;
};

// After "Use script n": back to the hand-picked view with the new picks highlighted.
function ShowAppliedScript() {
  ShowTab("build");
  if (!WIDE_LAYOUT.matches) { OnCalculate(); return; }   // on a phone, jump to the results like Calculate did
  $("tabBuild").parentElement.scrollIntoView({ block: "start", behavior: ScrollBehavior() });
  window.requestAnimationFrame(() => {
    document.querySelectorAll("#panelBuild select").forEach((select) => {
      if (select.value) Flash(select.parentElement);
    });
  });
  const bar = $("scorebar");
  bar.classList.remove("is-updated");
  void bar.offsetWidth;
  bar.classList.add("is-updated");
}

// After Generate: make sure the first result is on screen (it sits under the options on narrower layouts).
function RevealGenerated() {
  const result = $("genResult");
  const box = result.getBoundingClientRect();
  if (box.top > window.innerHeight * 0.75 || box.top < 0) {
    result.scrollIntoView({ block: "start", behavior: ScrollBehavior() });
  }
}

// ---------- unlocked-tags sheet ----------

let sheetOpener = null;
function OpenAvailabilitySheet() {
  BuildAvailability();
  const sheet = $("availSheet");
  if (sheet.open) return;
  sheetOpener = document.activeElement;
  document.documentElement.classList.add("sheet-open");
  sheet.showModal();
  $("availClose").focus();
}

function InitSheet() {
  const sheet = $("availSheet");
  $("genAvailOpen").addEventListener("click", OpenAvailabilitySheet);
  $("storyAvailNote").addEventListener("click", OpenAvailabilitySheet);
  for (const id of ["availClose", "availDone"]) $(id).addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });   // a click on the dimmed backdrop
  sheet.addEventListener("close", () => {
    document.documentElement.classList.remove("sheet-open");
    const back = sheetOpener && sheetOpener.isConnected && !sheetOpener.closest("[hidden]") ? sheetOpener : null;
    if (back) back.focus({ preventScroll: true });
  });
}

// ---------- header: search shortcut, height, toast ----------

function InitSearchShortcut() {
  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof Element && event.target.closest("input, select, textarea, [contenteditable]");
    const wantsSearch = ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !typing);
    if (!wantsSearch || document.querySelector("dialog[open]")) return;
    const input = $("tagSearch");
    if (input.disabled) return;
    event.preventDefault();
    input.focus();
    input.select();
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || "")) document.querySelector(".search-key").textContent = "⌘K";
}

// The sticky header's height, for the sticky results panel and for scrolling fields into view under it.
function InitHeaderHeight() {
  const header = document.querySelector(".site-header");
  const apply = () => document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  apply();
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(header);
}

// The search writes what it did into #searchHelp. Show that briefly as a toast.
function InitToast() {
  const toast = $("searchHelp");
  let timer = 0;
  new MutationObserver(() => {
    if (!toast.textContent.trim()) return;
    toast.classList.add("is-shown");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => toast.classList.remove("is-shown"), 2800);
  }).observe(toast, { childList: true, characterData: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", () => {
  InitTabs();
  InitSheet();
  InitSearchShortcut();
  InitHeaderHeight();
  InitToast();
});
