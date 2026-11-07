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

// ---------- script generator ----------

const GENERATOR_DEFAULTS = { objective: "quality", supporting: 3, themes: 3, antagonist: true, finale: true, keep: true };
let lastGenerated = null;

function GeneratorSettings() {
  return {
    objective: $("genObjective").value,
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
  $("genObjective").value = saved.objective;
  $("genSupporting").value = String(Math.min(saved.supporting, MAX_SUPPORTING));
  $("genThemes").value = String(Math.min(saved.themes, MAX_THEMES_EVENTS));
  $("genAntagonist").checked = saved.antagonist;
  $("genFinale").checked = saved.finale;
  $("genKeep").checked = saved.keep;

  $("generatorCard").addEventListener("change", (event) => {
    if (event.target.closest(".gen-options")) WriteStored(GENERATOR_KEY, GeneratorSettings());
  });
  $("genBtn").addEventListener("click", OnGenerate);
  $("genApply").addEventListener("click", ApplyGenerated);
  $("resetBtn").addEventListener("click", ClearGenerated);
}

function ClearGenerated() {
  lastGenerated = null;
  $("genResult").hidden = true;
  $("genMessage").hidden = true;
}

function GeneratorMessage(text) {
  $("genResult").hidden = true;
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
  const button = $("genBtn");
  button.disabled = true;
  button.textContent = "Generating…";
  $("genMessage").hidden = true;

  // Let the button repaint before the search runs.
  window.setTimeout(() => {
    try {
      lastGenerated = GenerateScript({
        genres: named.map((entry) => ({ tag: tagsByKey[entry.tag_key], percentage: entry.percentage })),
        locked: settings.keep ? LockedFromPage() : {},
        limits: {
          setting: 1, protagonist: 1,
          antagonist: settings.antagonist ? 1 : 0,
          finale: settings.finale ? 1 : 0,
          supporting: settings.supporting,
          themes: settings.themes
        },
        objective: settings.objective
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

function RenderGenerated(generated) {
  const result = generated.result;
  const compatText = result.compatibility.toFixed(1);
  $("genCompat").textContent = compatText;
  $("genCompat").style.color = ScaleColor((result.compatibility - 1) / 4);
  $("genMod").textContent = Signed(result.scoreModifier * 100, 1, "%");
  $("genMod").style.color = ScaleColor(0.5 + Clamp(result.scoreModifier * 100 / MODIFIER_SCALE_PERCENT, -1, 1) / 2);
  $("genArt").textContent = Signed(result.art, 1, "");
  $("genCom").textContent = Signed(result.commercial, 1, "");
  $("genLean").textContent = result.leans;

  const list = $("genList");
  list.textContent = "";
  for (const group of generated.groups) {
    for (const pick of generated.picks[group.key]) {
      const item = MakeEl("li", "gen-item");
      item.appendChild(MakeEl("span", "gen-cat", pick.tag.category === "Event" ? "Event" : group.label));
      const name = MakeEl("span", "gen-name", pick.tag.name);
      if (pick.locked) name.appendChild(MakeEl("span", "gen-kept", "kept"));
      item.appendChild(name);
      const change = generated.contributions[pick.tag.tag_id] || 0;
      const delta = MakeEl("span", "gen-delta " + (change >= 0 ? "is-up" : "is-down"), Signed(change * 100, 1, "%"));
      delta.title = "Score modifier with this tag, compared with leaving it out";
      item.appendChild(delta);
      list.appendChild(item);
    }
  }
  $("genResult").hidden = false;
  Announce("Script generated. Compatibility " + compatText + " out of 5, score modifier " + $("genMod").textContent + ".");
}

function ApplyGenerated() {
  if (!lastGenerated) return;
  const picks = lastGenerated.picks;
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
  OnCalculate();   // reveals the results and scrolls to them, the same as pressing Calculate
  Announce("Generated script applied.");
}

document.addEventListener("DOMContentLoaded", () => {
  InitFitHints();
  InitGenerator();
});
