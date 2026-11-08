// Fork addition (reyjr77): fit hints on every dropdown, and the script generator card.
// The maths lives in components/Quick Mode/ScriptGenerator.js. Upstream files only call UpdateFitHints().

const FIT_HINTS_KEY = "hollywood_animal_fit_hints";
const GENERATOR_KEY = "hollywood_animal_generator";

function ReadStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function WriteStored(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage blocked */ }
}

// ---------- fit hints ----------
// Each option shows the compatibility and score modifier the script would have if you picked it, coloured on the
// same red, white, green scale as the results. The best option in each dropdown gets a star.

let fitHintsOn = ReadStored(FIT_HINTS_KEY, true) !== false;

// Which story slot a select on the page fills, or null for selects that are not part of the script.
function SlotOf(select) {
  if (select.dataset.genre !== undefined) return { type: "genre", index: Number(select.dataset.genre) };
  if (select.dataset.field) return { type: "field", name: select.dataset.field };
  if (select.dataset.list) return { type: "list", list: select.dataset.list, index: Number(select.dataset.index) };
  return null;
}

// The current script, with one slot swapped for `tagKey`. Same shape as GetChosenTags().
function ChosenWithSlot(slot, tagKey) {
  const chosen = [];
  genreEntries.forEach((entry, i) => {
    const key = slot.type === "genre" && slot.index === i ? tagKey : entry.tag_key;
    if (key && tagsByKey[key]) chosen.push({ tag: tagsByKey[key], percentage: entry.percentage, isGenre: true });
  });
  for (const [name, field] of Object.entries(SINGLE_FIELDS)) {
    const key = slot.type === "field" && slot.name === name ? tagKey : field.ref.value;
    if (key && tagsByKey[key]) chosen.push({ tag: tagsByKey[key], percentage: null, isGenre: false });
  }
  for (const [listId, entries] of [["supportingList", supportingEntries], ["themesList", themeEventEntries]]) {
    entries.forEach((entry, i) => {
      const key = slot.type === "list" && slot.list === listId && slot.index === i ? tagKey : entry.value;
      if (key && tagsByKey[key]) chosen.push({ tag: tagsByKey[key], percentage: null, isGenre: false });
    });
  }
  return chosen;
}

function HintText(label, result, isBest) {
  return (isBest ? "★ " : "") + label + "  (" + result.compatibility.toFixed(1) + " · " +
    Signed(result.scoreModifier * 100, 1, "%") + ")";
}

function UpdateFitHints() {
  if (!isReady) return;
  BuildAvailability();   // the first call after the game data loads builds the unlocked-tags checklist
  const toggle = $("fitHintsToggle");
  if (toggle) toggle.checked = fitHintsOn;
  const hasGenre = genreEntries.some((entry) => entry.tag_key);
  $("fitHintsNote").hidden = !fitHintsOn || hasGenre;

  document.querySelectorAll("#main select").forEach((select) => {
    const slot = SlotOf(select);
    if (!slot) return;
    const scored = [];
    for (const option of select.options) {
      if (!option.value) continue;
      if (option.dataset.label === undefined) option.dataset.label = option.textContent;
      option.textContent = option.dataset.label;
      option.style.color = "";
      if (!fitHintsOn || option.disabled || option.value === select.value) continue;
      const chosen = ChosenWithSlot(slot, option.value);
      if (!chosen.some((item) => item.isGenre)) continue;
      try {
        scored.push({ option, result: EvaluateForSearch(chosen, false) });
      } catch (error) {
        // a missing pair in the data: leave this option without a hint
      }
    }
    if (!scored.length) return;
    let best = scored[0];
    for (const entry of scored) if (entry.result.scoreModifier > best.result.scoreModifier) best = entry;
    for (const entry of scored) {
      entry.option.textContent = HintText(entry.option.dataset.label, entry.result, entry === best);
      entry.option.style.color = ScaleColor((entry.result.compatibility - 1) / 4);
    }
  });
}

function InitFitHints() {
  const toggle = $("fitHintsToggle");
  toggle.checked = fitHintsOn;
  toggle.addEventListener("change", () => {
    fitHintsOn = toggle.checked;
    WriteStored(FIT_HINTS_KEY, fitHintsOn);
    UpdateFitHints();
    Announce(fitHintsOn ? "Fit hints on." : "Fit hints off.");
  });
}

// ---------- unlocked tags ----------
// A checklist of every story tag. The generator only picks ticked tags, so players can match what they have unlocked
// in their own game. Stored as the unticked tag keys, so tags added in a game update start out ticked.

const UNAVAILABLE_KEY = "hollywood_animal_unavailable_tags";
const AVAILABILITY_GROUPS = [
  { label: "Settings", category: "Setting" },
  { label: "Protagonists", category: "Protagonist" },
  { label: "Antagonists", category: "Antagonist" },
  { label: "Supporting characters", category: "Supporting Character" },
  { label: "Themes", category: "Theme" },
  { label: "Events", category: "Event" },
  { label: "Finales", category: "Finale" }
];
let unavailableTags = new Set(ReadStored(UNAVAILABLE_KEY, []));
let availabilityBuilt = false;

function AvailabilityBoxes(scope) {
  return [...(scope || $("genAvailGroups")).querySelectorAll("input[type=checkbox]")];
}

function SaveAvailability() {
  unavailableTags = new Set(AvailabilityBoxes().filter((box) => !box.checked).map((box) => box.value));
  WriteStored(UNAVAILABLE_KEY, [...unavailableTags]);
  UpdateAvailabilityCounts();
}

function UpdateAvailabilityCounts() {
  let total = 0;
  let ticked = 0;
  document.querySelectorAll(".gen-avail-group").forEach((group) => {
    const boxes = AvailabilityBoxes(group);
    const on = boxes.filter((box) => box.checked).length;
    group.querySelector(".gen-avail-n").textContent = on + " of " + boxes.length;
    total += boxes.length;
    ticked += on;
  });
  const text = ticked === total ? "All " + total + " tags" : ticked + " of " + total + " tags";
  $("genAvailCount").textContent = text;
  if ($("genSheetCount")) $("genSheetCount").textContent = text + " ticked";
}

// Tick or untick the boxes in `scope` that the filter is showing.
function SetAvailability(scope, value) {
  for (const box of AvailabilityBoxes(scope)) {
    if (!box.closest(".gen-avail-tag").hidden) box.checked = value;
  }
  SaveAvailability();
}

function FilterAvailability() {
  const query = $("genAvailFilter").value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll(".gen-avail-group").forEach((group) => {
    let groupShown = 0;
    group.querySelectorAll(".gen-avail-tag").forEach((label) => {
      label.hidden = query !== "" && !label.dataset.name.includes(query);
      if (!label.hidden) groupShown++;
    });
    group.hidden = groupShown === 0;
    shown += groupShown;
  });
  $("genAvailEmpty").hidden = shown > 0;
}

function BuildAvailability() {
  if (availabilityBuilt || !isReady) return;
  availabilityBuilt = true;
  const host = $("genAvailGroups");
  AVAILABILITY_GROUPS.forEach((group, index) => {
    const tags = (tagsByCategory[group.category] || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!tags.length) return;
    const section = MakeEl("div", "gen-avail-group");
    section.setAttribute("role", "group");
    section.setAttribute("aria-labelledby", "genAvailTitle-" + index);
    const head = MakeEl("div", "gen-avail-head");
    const title = MakeEl("span", "gen-avail-title", group.label);
    title.id = "genAvailTitle-" + index;
    head.appendChild(title);
    head.appendChild(MakeEl("span", "gen-avail-n"));
    for (const [text, value] of [["All", true], ["None", false]]) {
      const button = MakeEl("button", "gen-avail-link", text);
      button.type = "button";
      button.setAttribute("aria-label", (value ? "Tick all " : "Untick all ") + group.label.toLowerCase());
      button.addEventListener("click", () => SetAvailability(section, value));
      head.appendChild(button);
    }
    section.appendChild(head);
    const grid = MakeEl("div", "gen-avail-grid");
    for (const tag of tags) {
      const label = MakeEl("label", "fork-check gen-avail-tag");
      label.dataset.name = tag.name.toLowerCase();
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = tag.tag_key;
      box.checked = !unavailableTags.has(tag.tag_key);
      label.appendChild(box);
      label.appendChild(document.createTextNode(tag.name));
      grid.appendChild(label);
    }
    section.appendChild(grid);
    host.appendChild(section);
  });
  host.addEventListener("change", (event) => { if (event.target.type === "checkbox") SaveAvailability(); });
  $("genAvailFilter").addEventListener("input", FilterAvailability);
  $("genAvailAll").addEventListener("click", () => SetAvailability(host, true));
  $("genAvailNone").addEventListener("click", () => SetAvailability(host, false));
  UpdateAvailabilityCounts();
}

// ---------- import from a game save ----------
// A Hollywood Animal save (Saves/Profiles/<n>/<name>.json) keeps the unlocked tags in stateJson.tagPool as
// [{ Item1: tagKey, Item2: unlockDate }]. tagBank holds tags that research can still unlock, so it is ignored.

function UnlockedKeysFromSave(text) {
  const data = JSON.parse(text.replace(/^﻿/, ""));
  let state = data && data.stateJson !== undefined ? data.stateJson : data;
  if (typeof state === "string") state = JSON.parse(state);
  const pool = state && state.tagPool;
  if (!Array.isArray(pool)) throw new Error("no tagPool in this file");
  return pool.map((entry) => (typeof entry === "string" ? entry : entry && entry.Item1)).filter(Boolean);
}

// Ticks the save's unlocked tags, unticks the rest. Returns a summary for the message line.
function ImportSave(text, fileName) {
  BuildAvailability();
  const unlocked = new Set(UnlockedKeysFromSave(text));
  const boxes = AvailabilityBoxes();
  for (const box of boxes) box.checked = unlocked.has(box.value);
  $("genAvailFilter").value = "";
  FilterAvailability();
  SaveAvailability();
  const story = boxes.filter((box) => box.checked).length;
  const unknown = [...unlocked].filter((key) => !tagsByKey[key]);
  let message = "Imported " + (fileName || "your save") + ": " + story + " of " + boxes.length + " story tags unlocked.";
  if (unknown.length) {
    message += " " + unknown.length + (unknown.length === 1 ? " tag" : " tags") +
      " from your save " + (unknown.length === 1 ? "isn't" : "aren't") + " in the calculator's game data yet (" + unknown.join(", ") + ").";
    console.info("Tags in the save but not in the database:", unknown);
  }
  return { story, total: boxes.length, unknown, message };
}

function ShowImportMessage(text, isError) {
  const line = $("genImportMsg");
  line.textContent = text;
  line.classList.toggle("is-error", Boolean(isError));
  line.hidden = false;
}

function InitSaveImport() {
  const input = $("genSaveFile");
  $("genImportBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";   // so picking the same file again still fires
    if (!file) return;
    if (!isReady) { ShowImportMessage("The game data is still loading. Try again in a moment.", true); return; }
    try {
      const result = ImportSave(await file.text(), file.name.replace(/\.json$/i, ""));
      ShowImportMessage(result.message, false);
      Announce(result.message);
    } catch (error) {
      console.error(error);
      ShowImportMessage("That file doesn't look like a Hollywood Animal save. Pick the .json file (not the _map or .png file with the same name).", true);
    }
  });
}

// The tag_ids the generator may use, or null when everything is ticked.
function AvailableTagIds() {
  if (!unavailableTags.size) return null;
  const ids = new Set();
  for (const id in tagsById) {
    if (!unavailableTags.has(tagsById[id].tag_key)) ids.add(tagsById[id].tag_id);
  }
  return ids;
}

// ---------- script generator ----------

const GENERATOR_DEFAULTS = { objective: "quality", count: 5, supporting: 3, themes: 3, antagonist: true, finale: true, keep: true };
let lastGenerated = null;
let shownScript = 0;   // which script the carousel is showing

function RadioValue(name, fallback) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : fallback;
}

function SetRadio(name, value) {
  const radio = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
  if (radio) radio.checked = true;
}

function GeneratorSettings() {
  return {
    objective: RadioValue("genObjective", GENERATOR_DEFAULTS.objective),
    count: Number(RadioValue("genCount", String(GENERATOR_DEFAULTS.count))),
    supporting: Number($("genSupporting").value),
    themes: Number($("genThemes").value),
    antagonist: $("genAntagonist").checked,
    finale: $("genFinale").checked,
    keep: $("genKeep").checked
  };
}

function InitGenerator() {
  const saved = Object.assign({}, GENERATOR_DEFAULTS, ReadStored(GENERATOR_KEY, {}));
  for (const [id, max] of [["genSupporting", MAX_SUPPORTING], ["genThemes", MAX_THEMES_EVENTS]]) {
    const select = $(id);
    for (let n = 0; n <= max; n++) {
      const option = MakeEl("option", "", n === 0 ? "None" : "Up to " + n);
      option.value = String(n);
      select.appendChild(option);
    }
  }
  SetRadio("genObjective", GENERATOR_OBJECTIVES[saved.objective] ? saved.objective : GENERATOR_DEFAULTS.objective);
  SetRadio("genCount", ["1", "3", "5"].includes(String(saved.count)) ? String(saved.count) : String(GENERATOR_DEFAULTS.count));
  $("genSupporting").value = String(Math.min(saved.supporting, MAX_SUPPORTING));
  $("genThemes").value = String(Math.min(saved.themes, MAX_THEMES_EVENTS));
  $("genAntagonist").checked = saved.antagonist;
  $("genFinale").checked = saved.finale;
  $("genKeep").checked = saved.keep;

  $("panelGenerate").addEventListener("change", (event) => {
    if (event.target.closest(".gen-options")) WriteStored(GENERATOR_KEY, GeneratorSettings());
  });
  $("genBtn").addEventListener("click", OnGenerate);
  $("genApply").addEventListener("click", ApplyGenerated);
  InitCarousel();
  $("resetBtn").addEventListener("click", ClearGenerated);
}

function ClearGenerated() {
  lastGenerated = null;
  $("genResult").hidden = true;
  if ($("genEmpty")) $("genEmpty").hidden = false;
  $("genMessage").hidden = true;
}

function GeneratorMessage(text) {
  $("genResult").hidden = true;
  if ($("genEmpty")) $("genEmpty").hidden = false;
  $("genMessage").textContent = text;
  $("genMessage").hidden = false;
}

function LockedFromPage() {
  const tag = (key) => (key && tagsByKey[key] ? [tagsByKey[key]] : []);
  return {
    setting: tag(setting.value),
    protagonist: tag(protagonist.value),
    antagonist: tag(antagonist.value),
    finale: tag(finale.value),
    supporting: supportingEntries.flatMap((entry) => tag(entry.value)),
    themes: themeEventEntries.flatMap((entry) => tag(entry.value))
  };
}

function OnGenerate() {
  if (!isReady) return;
  const named = genreEntries.filter((entry) => entry.tag_key && tagsByKey[entry.tag_key]);
  if (named.length === 0) { GeneratorMessage("Pick at least one genre above first. The generator builds the rest of the script around it."); return; }
  if (named.length !== genreEntries.length) { GeneratorMessage("Choose a genre in each genre row, or remove the empty ones."); return; }

  const settings = GeneratorSettings();
  const available = AvailableTagIds();
  const locked = settings.keep ? LockedFromPage() : {};
  for (const [key, category, name] of [["setting", "Setting", "setting"], ["protagonist", "Protagonist", "protagonist"]]) {
    const hasLocked = locked[key] && locked[key].length;
    const hasAvailable = !available || (tagsByCategory[category] || []).some((tag) => available.has(tag.tag_id));
    if (!hasLocked && !hasAvailable) {
      GeneratorMessage("Every script needs a " + name + ". Tick at least one under Unlocked tags, or pick one in Story elements and turn on Keep what I've already picked.");
      return;
    }
  }

  const button = $("genBtn");
  button.disabled = true;
  button.textContent = "Generating…";
  $("genMessage").hidden = true;

  // Let the button repaint before the search runs.
  window.setTimeout(() => {
    try {
      lastGenerated = GenerateScript({
        genres: named.map((entry) => ({ tag: tagsByKey[entry.tag_key], percentage: entry.percentage })),
        locked,
        available,
        limits: {
          setting: 1, protagonist: 1,
          antagonist: settings.antagonist ? 1 : 0,
          finale: settings.finale ? 1 : 0,
          supporting: settings.supporting,
          themes: settings.themes
        },
        objective: settings.objective,
        count: settings.count
      });
      RenderGenerated(lastGenerated);
    } catch (error) {
      console.error(error);
      GeneratorMessage("Couldn't generate a script with these genres. The game data is missing a value for one of the pairs.");
    } finally {
      button.disabled = false;
      button.textContent = "Generate script";
    }
  }, 20);
}

// ---------- results carousel ----------

function InitCarousel() {
  $("genPrev").addEventListener("click", () => ShowScript(shownScript - 1, -1));
  $("genNext").addEventListener("click", () => ShowScript(shownScript + 1, 1));
  $("genResult").addEventListener("keydown", (event) => {
    if (event.target.closest("select, input")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); ShowScript(shownScript - 1, -1); }
    if (event.key === "ArrowRight") { event.preventDefault(); ShowScript(shownScript + 1, 1); }
  });
  // swipe on touch screens
  const card = $("genCard");
  let startX = null;
  let startY = null;
  card.addEventListener("pointerdown", (event) => { startX = event.clientX; startY = event.clientY; });
  card.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) ShowScript(shownScript + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });
  card.addEventListener("pointercancel", () => { startX = null; });
}

function RenderGenerated(generated) {
  const count = generated.scripts.length;
  const dots = $("genDots");
  dots.textContent = "";
  for (let i = 0; i < count; i++) {
    const dot = MakeEl("button", "gen-dot");
    dot.type = "button";
    dot.setAttribute("aria-label", "Show script " + (i + 1));
    dot.addEventListener("click", () => ShowScript(i, i > shownScript ? 1 : -1));
    dots.appendChild(dot);
  }
  $("genNav").hidden = count < 2;
  if ($("genEmpty")) $("genEmpty").hidden = true;
  $("genResult").hidden = false;
  if (typeof RevealGenerated === "function") RevealGenerated();   // see QuickModeLayout.js
  ShowScript(0, 0);
  const best = generated.scripts[0].result;
  const what = count > 1 ? count + " scripts generated. Best: " : "Script generated. ";
  Announce(what + "compatibility " + best.compatibility.toFixed(1) + " out of 5, score modifier " + Signed(best.scoreModifier * 100, 1, "%") + ".");
}

// The order the game's script screen uses: setting, then protagonist and antagonist, supporting characters, themes
// and events, and the finale last. (Display only: the search itself fills setting and protagonist first.)
const RESULT_ORDER = ["setting", "protagonist", "antagonist", "supporting", "themes", "finale"];
function ResultOrder(groups) {
  return groups.slice().sort((a, b) => RESULT_ORDER.indexOf(a.key) - RESULT_ORDER.indexOf(b.key));
}

// Show script `index` (wrapping round at either end). `direction` picks the slide-in animation.
function ShowScript(index, direction) {
  if (!lastGenerated) return;
  const scripts = lastGenerated.scripts;
  const count = scripts.length;
  shownScript = ((index % count) + count) % count;
  const script = scripts[shownScript];
  const result = script.result;

  $("genRank").textContent = shownScript === 0 ? "Best script" + (count > 1 ? " (1 of " + count + ")" : "") : "Script " + (shownScript + 1) + " of " + count;
  const gap = (result.scoreModifier - scripts[0].result.scoreModifier) * 100;
  if (shownScript === 0) $("genGap").textContent = "";
  else if (Math.abs(gap) < 0.05) $("genGap").textContent = "same modifier as best";
  else $("genGap").textContent = Signed(gap, 1, "%") + " modifier vs best";
  $("genDots").querySelectorAll(".gen-dot").forEach((dot, i) => {
    dot.classList.toggle("is-current", i === shownScript);
    if (i === shownScript) dot.setAttribute("aria-current", "true"); else dot.removeAttribute("aria-current");
  });
  $("genCard").setAttribute("aria-label", "Script " + (shownScript + 1) + " of " + count);
  $("genApply").textContent = count > 1 ? "Use script " + (shownScript + 1) : "Use this script";

  $("genCompat").textContent = result.compatibility.toFixed(1);
  $("genCompat").style.color = ScaleColor((result.compatibility - 1) / 4);
  $("genMod").textContent = Signed(result.scoreModifier * 100, 1, "%");
  $("genMod").style.color = ScaleColor(0.5 + Clamp(result.scoreModifier * 100 / MODIFIER_SCALE_PERCENT, -1, 1) / 2);
  $("genArt").textContent = Signed(result.art, 1, "");
  $("genCom").textContent = Signed(result.commercial, 1, "");
  $("genLean").textContent = result.leans;

  const list = $("genList");
  list.textContent = "";
  const best = scripts[0];
  const inBest = new Set(lastGenerated.groups.flatMap((group) => best.picks[group.key].map((pick) => pick.tag.tag_id)));
  for (const group of ResultOrder(lastGenerated.groups)) {
    for (const pick of script.picks[group.key]) {
      const item = MakeEl("li", "gen-item");
      item.appendChild(MakeEl("span", "gen-cat", pick.tag.category === "Event" ? "Event" : group.label));
      const name = MakeEl("span", "gen-name", pick.tag.name);
      if (pick.locked) name.appendChild(MakeEl("span", "gen-kept", "kept"));
      else if (shownScript > 0 && !inBest.has(pick.tag.tag_id)) name.appendChild(MakeEl("span", "gen-kept gen-new", "different"));
      item.appendChild(name);
      const change = script.contributions[pick.tag.tag_id] || 0;
      const delta = MakeEl("span", "gen-delta " + (change >= 0 ? "is-up" : "is-down"), Signed(change * 100, 1, "%"));
      delta.title = "Score modifier with this tag, compared with leaving it out";
      item.appendChild(delta);
      list.appendChild(item);
    }
  }

  const card = $("genCard");
  card.classList.remove("slide-next", "slide-prev");
  if (direction) {
    void card.offsetWidth;   // restart the animation
    card.classList.add(direction > 0 ? "slide-next" : "slide-prev");
  }
}

function ApplyGenerated() {
  if (!lastGenerated) return;
  const picks = lastGenerated.scripts[shownScript].picks;
  const first = (key) => (picks[key][0] ? picks[key][0].tag.tag_key : "");
  setting.value = first("setting");
  protagonist.value = first("protagonist");
  antagonist.value = first("antagonist");
  finale.value = first("finale");
  supportingEntries.length = 0;
  for (const pick of picks.supporting) supportingEntries.push({ value: pick.tag.tag_key });
  themeEventEntries.length = 0;
  for (const pick of picks.themes) themeEventEntries.push({ value: pick.tag.tag_key });
  RenderAll();
  if (typeof ShowAppliedScript === "function") ShowAppliedScript();   // see QuickModeLayout.js
  else OnCalculate();   // reveals the results and scrolls to them, the same as pressing Calculate
  Announce("Script " + (shownScript + 1) + " applied.");
}

document.addEventListener("DOMContentLoaded", () => {
  InitFitHints();
  InitGenerator();
  InitSaveImport();
});
