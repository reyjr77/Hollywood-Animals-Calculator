// Fork addition (reyjr77): the maths behind the fit hints and the script generator.
// The scores come from the upstream ScriptCompatibility() and FilmAppealSide() functions, so when upstream changes the
// game formulas these features follow. Nothing in this file touches the page.

// ---------- fast lookups ----------

// The whole pair table in memory, in the same "tagId:partnerId" format FetchPairScores() returns.
// 64k rows: loading it once is much faster than asking the database thousands of times.
let fullScoreMap = null;
function FullScoreMap() {
  if (fullScoreMap) return fullScoreMap;
  fullScoreMap = {};
  const rows = db.exec("SELECT tag_id, partner_id, score FROM pair_scores");
  if (rows.length) {
    for (const row of rows[0].values) fullScoreMap[row[0] + ":" + row[1]] = row[2];
  }
  return fullScoreMap;
}

// FilmAppealSide() looks genre pairs up in the database every call. The data never changes while the page is open,
// so remember each answer. (Errors are not cached, so a missing pair still throws like upstream.)
const genrePairCache = {};
const UncachedLookupGenrePair = LookupGenrePair;
LookupGenrePair = function (genreId, partnerId, valueField) {
  const key = genreId + ":" + partnerId + ":" + valueField;
  if (!(key in genrePairCache)) genrePairCache[key] = UncachedLookupGenrePair(genreId, partnerId, valueField);
  return genrePairCache[key];
};

// ---------- scoring a set of tags with the upstream functions ----------

// `chosen` uses the same shape as GetChosenTags(): [{ tag, percentage, isGenre }].
function EvaluateChosen(chosen, withAppeal) {
  const map = FullScoreMap();
  const script = ScriptCompatibility(chosen, map);
  const result = {
    compatibility: script.compatibility,
    scoreModifier: script.scoreModifier,
    negativeBonusFraction: script.negativeBonusFraction
  };
  if (withAppeal) {
    const art = FilmAppealSide(chosen, map, script.negativeBonusFraction, "art_value");
    const commercial = FilmAppealSide(chosen, map, script.negativeBonusFraction, "commercial_value");
    result.artRaw = art.raw;
    result.commercialRaw = commercial.raw;
    result.art = art.display;
    result.commercial = commercial.display;
    if (Math.abs(art.raw - commercial.raw) < 0.1) result.leans = "Balanced";
    else result.leans = art.raw > commercial.raw ? "Art" : "Commercial";
  }
  return result;
}

// ---------- fast scoring for the search ----------
// The generator scores hundreds of thousands of candidate scripts. Upstream's GetScore() builds a text key for every
// pair, which is far too slow for that, so the search uses this copy of ScriptCompatibility() and FilmAppealSide()
// built on a number grid. It reuses upstream's Shrink() and CLAMP(), and checks itself against the upstream functions
// before it is trusted: if upstream ever changes a formula and this copy no longer agrees, the generator quietly falls
// back to the upstream functions (slower, never wrong). The numbers shown to the player always come from upstream.

let pairGrid = null;
let pairGridSize = 0;
function PairGrid() {
  if (pairGrid) return pairGrid;
  let maxId = 0;
  for (const id in tagsById) maxId = Math.max(maxId, Number(id));
  pairGridSize = maxId + 1;
  pairGrid = new Float64Array(pairGridSize * pairGridSize).fill(NaN);
  const rows = db.exec("SELECT tag_id, partner_id, score FROM pair_scores");
  if (rows.length) {
    for (const row of rows[0].values) pairGrid[row[0] * pairGridSize + row[1]] = row[2];
  }
  return pairGrid;
}

function GenreRawValue(genres, valueField) {
  const sorted = genres.slice().sort((a, b) => b.percentage - a.percentage);
  const top = sorted[0] || null;
  const second = sorted[1] || null;
  if (top && second && (top.percentage + second.percentage + 0.0001 >= 0.7) && (second.percentage + 0.0001 >= 0.35)) {
    return LookupGenrePair(top.tag.tag_id, second.tag.tag_id, valueField);
  }
  if (top && top.percentage >= 0.5) return top.tag[valueField];
  return 0;
}

function FastEvaluate(chosen, withAppeal) {
  const grid = PairGrid();
  const size = pairGridSize;
  const n = chosen.length;
  let genreScore = 0;
  let genreCount = 0;
  for (const c of chosen) if (c.isGenre) { genreScore += c.percentage; genreCount++; }
  const maxGain = genreScore * 0.05;
  const maxLoss = genreScore * 0.9 / n;

  let totalChange = 0;
  let negativeSum = 0;
  let weightedAvgSum = 0;
  for (let r = 0; r < n; r++) {
    const R = chosen[r];
    const rowBase = R.tag.tag_id * size;
    let totalPW = 0;
    let totalW = 0;
    for (let q = 0; q < n; q++) {
      const P = chosen[q];
      if (P.tag.tag_id === R.tag.tag_id) continue;
      const p = (grid[rowBase + P.tag.tag_id] - 3) / 2;
      let weight;
      if (P.isGenre) weight = p >= 0 ? genreCount * P.percentage : 20 * P.percentage;
      else if (p >= 0) weight = 1;
      else weight = P.tag.category === "Setting" ? 5 : 3;
      totalPW += p * weight;
      totalW += weight;
    }
    const avg = n === 1 ? 0 : totalPW / totalW;
    const tagWeight = R.isGenre ? genreCount * R.percentage : 1;
    const change = (avg >= 0 ? maxGain : maxLoss) * avg * tagWeight;
    totalChange += change;
    if (change < 0) negativeSum += change;
    weightedAvgSum += avg * tagWeight;
  }
  const negativeBonusFraction = negativeSum < 0 ? (-negativeSum) / (genreScore * 0.9) : 0;
  const result = {
    compatibility: 3 + 2 * (weightedAvgSum / n),
    scoreModifier: totalChange >= 0 ? totalChange * 0.9 : totalChange * 1.25,
    negativeBonusFraction
  };
  if (withAppeal) {
    const genres = chosen.filter((c) => c.isGenre);
    for (const [field, key] of [["art_value", "artRaw"], ["commercial_value", "commercialRaw"]]) {
      let settingSum = 0;
      let contentSum = 0;
      for (const c of chosen) {
        if (c.tag.category === "Setting") settingSum += Shrink(c.tag[field], negativeBonusFraction);
        else if (c.tag.category !== "Genre") contentSum += Shrink(c.tag[field], negativeBonusFraction);
      }
      const genreBonus = Shrink(GenreRawValue(genres, field), negativeBonusFraction);
      result[key] = (genreBonus + CLAMP(settingSum, -0.084, 0.084) + CLAMP(contentSum, -0.084, 0.084)) * 10;
    }
  }
  return result;
}

// null until checked, then true (use FastEvaluate) or false (use the upstream functions).
let fastEvaluateTrusted = null;
function FastEvaluateAgrees() {
  if (fastEvaluateTrusted !== null) return fastEvaluateTrusted;
  const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  // Fixed sample scripts, so a disagreement is reproducible.
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (category) => {
    const list = tagsByCategory[category] || [];
    return list[Math.floor(next() * list.length)];
  };
  try {
    for (let t = 0; t < 60; t++) {
      const chosen = [];
      const used = new Set();
      const add = (tag, percentage, isGenre) => {
        if (!tag || used.has(tag.tag_id)) return;
        used.add(tag.tag_id);
        chosen.push({ tag, percentage, isGenre });
      };
      const shares = [[1], [0.6, 0.4], [0.5, 0.3, 0.2]][t % 3];
      for (const share of shares) add(pick("Genre"), share, true);
      for (const category of ["Setting", "Protagonist", "Antagonist", "Finale", "Supporting Character", "Theme", "Event", "Theme"]) {
        if (next() < 0.8) add(pick(category), null, false);
      }
      const slow = EvaluateChosen(chosen, true);
      const fast = FastEvaluate(chosen, true);
      if (!close(slow.compatibility, fast.compatibility) || !close(slow.scoreModifier, fast.scoreModifier) ||
          !close(slow.artRaw, fast.artRaw) || !close(slow.commercialRaw, fast.commercialRaw)) {
        throw new Error("fast scoring disagrees with upstream on sample script " + t);
      }
    }
    fastEvaluateTrusted = true;
  } catch (error) {
    console.warn("Script generator: using the upstream scoring functions.", error);
    fastEvaluateTrusted = false;
  }
  return fastEvaluateTrusted;
}

function EvaluateForSearch(chosen, withAppeal) {
  return FastEvaluateAgrees() ? FastEvaluate(chosen, withAppeal) : EvaluateChosen(chosen, withAppeal);
}

// ---------- the generator ----------

// How much one appeal point is worth next to the score modifier when leaning a script one way.
// Appeal points run about -2 to +2 and the modifier about -0.5 to +0.5, so 0.05 lets appeal break near-ties and
// swing close calls without ever trading away a good fit for a clashing tag.
const GENERATOR_APPEAL_WEIGHT = 0.05;
const GENERATOR_MAX_MOVES = 80;
const GENERATOR_STARTS = 12;      // how many of the best settings to start a search from
const GENERATOR_EPSILON = 1e-9;

const GENERATOR_OBJECTIVES = {
  quality:    { appeal: false, score: (r) => r.scoreModifier },
  art:        { appeal: true,  score: (r) => r.scoreModifier + GENERATOR_APPEAL_WEIGHT * r.artRaw },
  commercial: { appeal: true,  score: (r) => r.scoreModifier + GENERATOR_APPEAL_WEIGHT * r.commercialRaw }
};

// The story slots the generator fills, in the order they appear on the page.
const GENERATOR_GROUPS = [
  { key: "setting",     label: "Setting",              categories: ["Setting"] },
  { key: "protagonist", label: "Protagonist",          categories: ["Protagonist"] },
  { key: "antagonist",  label: "Antagonist",           categories: ["Antagonist"] },
  { key: "finale",      label: "Finale",               categories: ["Finale"] },
  { key: "supporting",  label: "Supporting character", categories: ["Supporting Character"] },
  { key: "themes",      label: "Theme or event",       categories: ["Theme", "Event"] }
];

// options: {
//   genres:    [{ tag, percentage }]                     the player's genres, kept as they are
//   locked:    { setting: [tag], supporting: [tag], ... } tags to keep (may be empty)
//   limits:    { setting: 1, protagonist: 1, antagonist: 0|1, finale: 0|1, supporting: n, themes: n }
//   objective: "quality" | "art" | "commercial"
// }
// Returns { picks: { groupKey: [{ tag, locked }] }, groups, result, contributions: { tag_id: modifier change } }.
//
// Method: a local search. From a starting script, repeatedly make the single best move (add, swap or drop one tag)
// until no move improves the objective. Setting and protagonist are filled first because a script needs them.
// The setting decides what kind of story fits (a war film and a costume romance share almost no tags), so one search
// tends to get stuck with whichever setting it tried first. It runs again from each of the most promising settings,
// and a search that leans Art or Commercial also starts from the best plain-quality script. The best script wins.
function GenerateScript(options) {
  const objectiveKey = GENERATOR_OBJECTIVES[options.objective] ? options.objective : "quality";
  const genreChosen = options.genres.map((g) => ({ tag: g.tag, percentage: g.percentage, isGenre: true }));

  const groups = GENERATOR_GROUPS.map((group) => {
    const locked = (options.locked && options.locked[group.key]) || [];
    const required = group.key === "setting" || group.key === "protagonist" ? 1 : 0;
    const max = Math.max(locked.length, options.limits[group.key] || 0, required);
    const candidates = [];
    for (const category of group.categories) {
      for (const tag of tagsByCategory[category] || []) candidates.push(tag);
    }
    const lockedIds = new Set(locked.map((tag) => tag.tag_id));
    return { key: group.key, min: Math.max(required, locked.length), max, locked, lockedIds, candidates };
  });

  function Build(current) {
    const chosen = genreChosen.slice();
    for (const group of groups) {
      for (const tag of current[group.key]) chosen.push({ tag, percentage: null, isGenre: false });
    }
    return chosen;
  }
  function Copy(current) {
    const copy = {};
    for (const group of groups) copy[group.key] = current[group.key].slice();
    return copy;
  }
  const lockedOnly = {};
  for (const group of groups) lockedOnly[group.key] = group.locked.slice();

  function Search(start, objective) {
    const Score = (current) => objective.score(EvaluateForSearch(Build(current), objective.appeal));
    const picks = Copy(start);
    const With = (groupKey, list) => {
      const next = Object.assign({}, picks);
      next[groupKey] = list;
      return next;
    };

    let currentScore = null;
    for (let move = 0; move < GENERATOR_MAX_MOVES; move++) {
      const short = groups.filter((group) => picks[group.key].length < group.min);
      const scope = short.length ? [short[0]] : groups;   // fill a required slot before anything else
      let best = null;
      const consider = (score, groupKey, list) => {
        if (!best || score > best.score) best = { score, group: groupKey, list };
      };

      for (const group of scope) {
        const list = picks[group.key];
        const used = new Set(list.map((tag) => tag.tag_id));

        if (list.length < group.max) {
          for (const tag of group.candidates) {
            if (used.has(tag.tag_id)) continue;
            const added = list.concat([tag]);
            consider(Score(With(group.key, added)), group.key, added);
          }
        }
        if (short.length) continue;   // while a required slot is empty, only additions are allowed

        list.forEach((oldTag, index) => {
          if (group.lockedIds.has(oldTag.tag_id)) return;
          for (const tag of group.candidates) {
            if (used.has(tag.tag_id)) continue;
            const swapped = list.slice();
            swapped[index] = tag;
            consider(Score(With(group.key, swapped)), group.key, swapped);
          }
          if (list.length > group.min) {
            const dropped = list.filter((_, i) => i !== index);
            consider(Score(With(group.key, dropped)), group.key, dropped);
          }
        });
      }

      if (!best) break;
      if (short.length === 0) {
        if (currentScore === null) currentScore = Score(picks);
        if (!(best.score > currentScore + GENERATOR_EPSILON)) break;
      }
      picks[best.group] = best.list;
      currentScore = best.score;
    }
    return { picks, score: Score(picks) };
  }

  function BestOf(objectiveName, extraStarts) {
    const objective = GENERATOR_OBJECTIVES[objectiveName];
    const starts = extraStarts.slice();
    const settingGroup = groups.find((group) => group.key === "setting");
    if (settingGroup.locked.length) {
      starts.push(lockedOnly);
    } else {
      const ranked = settingGroup.candidates
        .map((tag) => {
          const start = Object.assign({}, lockedOnly, { setting: [tag] });
          return { start, score: objective.score(EvaluateForSearch(Build(start), objective.appeal)) };
        })
        .sort((a, b) => b.score - a.score);
      for (const entry of ranked.slice(0, GENERATOR_STARTS)) starts.push(entry.start);
    }
    let best = null;
    for (const start of starts) {
      const found = Search(start, objective);
      if (!best || found.score > best.score + GENERATOR_EPSILON) best = found;
    }
    return best.picks;
  }

  const extraStarts = objectiveKey === "quality" ? [] : [BestOf("quality", [])];
  const picks = BestOf(objectiveKey, extraStarts);

  // The numbers shown come from the upstream functions. Each tag's worth is the score modifier with it, minus the
  // score modifier without it.
  const finalChosen = Build(picks);
  const result = EvaluateChosen(finalChosen, true);
  const contributions = {};
  for (const item of finalChosen) {
    if (item.isGenre) continue;
    const without = finalChosen.filter((other) => other !== item);
    contributions[item.tag.tag_id] = result.scoreModifier - EvaluateChosen(without, false).scoreModifier;
  }

  const output = {};
  for (const group of groups) {
    output[group.key] = picks[group.key].map((tag) => ({ tag, locked: group.lockedIds.has(tag.tag_id) }));
  }
  return { picks: output, groups: GENERATOR_GROUPS, result, contributions };
}
