// Fork addition (reyjr77): the Gift Guide page.
// Reads a Hollywood Animal save in the browser and shows, for every person, whether they are shady, their favorite
// illegal gift, whether they take it, and which legal gifts still give a full boost.
//
// The rules mirror the game code (v0.8.72):
// - CharacterDataWrapper.AcceptsIllegalGift: shady (and no trait that blocks illegal gifts) or an addict, and the gift
//   is their one favorite.
// - CharactersManager.GivePresentTo: security agents refuse every illegal gift on the gift screen; a wrong illegal
//   gift adds a strike (3 = offended); an addict offered another drug just laughs; the same legal gift gives its full
//   boost twice within 365 days and costs 5% attitude after that; illegal gifts are never counted as repeats.
// - NegotiationView: a shady agent's favorite counts 3x in contract negotiations.

const ROSTER_KEY = "hollywood_animal_gift_roster";
const VIEW_KEY = "hollywood_animal_gift_view";
const STATE = { HIRED_BY_PLAYER: 0x2, DEAD: 0x10, HIRED_BY_COMPETITOR: 0x20, LOCKED: 0x40, HOSPITAL: 0x80, VACATION: 0x200, OFFENDED: 0x1000, IMPRISONED: 0x20000, KIDNAPPED: 0x40100 };
const TYPE = { WORLD: 0, TALENT: 1, LIEUTENANT: 2, AGENT: 3, CAPTAIN: 4 };
const PLAYER_STUDIO = "PL";
const SHORT_GIFT_NAMES = { WATCH: "Watch", SIGARS: "Cigars", ALCOHOL: "Whiskey", WARDROBE_COUTURE: "Couture wardrobe", EUROPEAN_SPORTCAR: "Sports car" };
const MINUS = "−";

let data = null;      // GiftGuideData.json
let roster = null;    // what we keep from the save
let view = { group: "mine", sort: "verdict", dir: 1, text: "", role: "", verdict: "", gift: "", studio: "" };

const $ = (id) => document.getElementById(id);

function El(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function ReadStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function WriteStored(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage full or blocked */ }
}

function Announce(text) {
  const live = $("statusLive");
  live.textContent = "";
  window.setTimeout(() => { live.textContent = text; }, 30);
}

let toastTimer = 0;
function Toast(text) {
  const toast = $("toast");
  toast.textContent = text;
  toast.classList.add("is-shown");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-shown"), 3200);
}

// ---------- dates ----------

function ParseGameDate(text) {   // "18-07-1930"
  const match = /^(\d{2})-(\d{2})-(\d{4})/.exec(text || "");
  return match ? Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) : null;
}

function FormatDate(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const DAY = 86400000;

// ---------- reading a save ----------

function NameOf(character) {
  if (character.customName) return character.customName;
  const part = (id) => {
    const index = data.names.idMap[String(id)];
    return index === undefined ? "?" : data.names.strings[index];
  };
  return part(character.firstNameId) + " " + part(character.lastNameId);
}

function RoleOf(character) {
  const keys = Object.keys(character.professions || {});
  const primary = keys[0] || "";
  if (character.type === TYPE.AGENT) return { key: "Agent", name: "Security agent" };
  return { key: primary, name: data.professions[primary.toUpperCase()] || primary.replace(/([a-z])([A-Z])/g, "$1 $2") };
}

function GiftByIntId(intId) {
  for (const [key, gift] of Object.entries(data.gifts)) {
    if (gift.intId === intId) return Object.assign({ key }, gift);
  }
  return null;
}

function BuildRoster(save, fileName) {
  const state = save && save.stateJson !== undefined ? save.stateJson : save;
  if (!state || !Array.isArray(state.characters)) throw new Error("no characters in this file");
  const daysPassed = parseFloat(String(state.timePassed || "0"));
  const gameDate = Date.UTC(1929, 0, 1) + daysPassed * DAY;
  const perks = new Set(state.openedPerks || []);
  const inventory = state.otherCountableResources || {};
  const noIllegalTraits = new Set(data.noIllegalGiftTraits);
  const hiddenTraits = new Set(data.hiddenTraits);

  const people = [];
  for (const c of state.characters) {
    const flags = Number(c.state) || 0;
    if (flags & STATE.DEAD || flags & STATE.LOCKED) continue;
    if (c.deathDate && !String(c.deathDate).startsWith("01-01-0001")) continue;
    if (c.type === TYPE.WORLD) continue;
    const traits = (c.labels || []).slice();
    const visibleTraits = traits.filter((t) => !hiddenTraits.has(t));
    const addict = traits.includes("JUNKIE");
    const shady = Boolean(c.isShady) && !(c.type === TYPE.TALENT && traits.some((t) => noIllegalTraits.has(t)));
    const favorite = GiftByIntId(Number(c.prefIlGift));
    const studio = flags & STATE.HIRED_BY_PLAYER || c.studioId === PLAYER_STUDIO ? PLAYER_STUDIO : (c.studioId || null);
    const dossier = c.dossier || null;
    const known = dossier && Array.isArray(dossier.illPrefs) ? (dossier.illPrefs.length ? "favorite" : "none") : null;
    people.push({
      id: c.id,
      name: NameOf(c),
      role: RoleOf(c),
      skill: Number(Object.values(c.professions || {})[0]) || 0,      // 0 to 1; the game shows it as stars out of 10
      limit: Number(c.limit !== undefined ? c.limit : c.Limit) || 0,  // how far the skill can grow
      type: c.type,
      studio,
      group: studio === PLAYER_STUDIO ? "mine" : studio ? "other" : "free",
      shady,
      addict,
      favorite: favorite && favorite.illegal ? favorite.key : null,
      known,
      strikes: Number(c.strikes) || 0,
      attitude: Number(c.attitude) || 0,
      mood: Number(c.mood) || 0,
      offended: Boolean(flags & STATE.OFFENDED),
      away: flags & STATE.IMPRISONED ? "In prison" : flags & STATE.KIDNAPPED ? "Kidnapped" : flags & STATE.HOSPITAL ? "In hospital" : flags & STATE.VACATION ? "On vacation" : null,
      traits: visibleTraits,
      traitSlotsFull: visibleTraits.length >= 2,
      gifts: (c.giftHistory || []).map((record) => ({ id: record.giftId, date: ParseGameDate(record.date) })).filter((r) => r.date !== null)
    });
  }
  return {
    fileName,
    studioName: state.studioName || "Your studio",
    gameDate,
    perks: [...perks],
    inventory: Object.fromEntries(Object.entries(inventory).filter(([key, amount]) => data.gifts[key] && Number(amount) > 0)),
    importedAt: Date.now(),
    people
  };
}

// ---------- the rules ----------

// What giving this person an illegal gift does. kind: takes | agent | shadyNoFav | legal | offended
function Verdict(person) {
  if (person.offended) return { kind: "offended", text: "Offended", note: "Can't receive gifts right now.", rank: 5 };
  const fav = person.favorite ? data.gifts[person.favorite] : null;
  if (person.type === TYPE.AGENT) {
    if (person.shady && fav) return { kind: "agent", text: "Negotiations only", note: "The gift screen refuses illegal gifts. In contract negotiations, " + fav.name + " counts 3×.", rank: 3 };
    return { kind: "legal", text: "Legal only", note: "Security agents refuse illegal gifts.", rank: 4 };
  }
  if ((person.shady || person.addict) && fav) {
    const note = person.addict ? "Addict: a different drug is laughed off, no strike." : null;
    return { kind: "takes", text: "Takes their favorite", note, rank: 1 };
  }
  if (person.shady) return { kind: "shadyNoFav", text: "Legal only", note: "Shady, but no favorite: every illegal gift is refused.", rank: 2 };
  return { kind: "legal", text: "Legal only", note: "Not shady: every illegal gift is refused.", rank: 4 };
}

function ShortName(giftKey) {
  return SHORT_GIFT_NAMES[giftKey] || (data.gifts[giftKey] ? data.gifts[giftKey].name : giftKey);
}

// How each legal gift stands for this person right now: fresh, one more full boost, or used up until a date.
function LegalGiftStatus(person, giftKey) {
  const windowStart = roster.gameDate - data.rules.legalRepeatWindowDays * DAY;
  const recent = person.gifts.filter((g) => g.id === giftKey && g.date > windowStart).map((g) => g.date).sort((a, b) => a - b);
  const left = Math.max(0, data.rules.legalFullBoostTimes - recent.length);
  if (left > 0) return { left, until: null };
  // the oldest of the last two drops out of the window first
  const blocking = recent[recent.length - data.rules.legalFullBoostTimes];
  return { left: 0, until: blocking + data.rules.legalRepeatWindowDays * DAY };
}

function LegalGifts() {
  return Object.entries(data.gifts).filter(([, gift]) => !gift.illegal).sort((a, b) => b[1].attitudeBonus - a[1].attitudeBonus);
}

function Percent(value) {
  return Math.round(value * 100) + "%";
}

// ---------- rendering ----------

function Chip(text, className, title) {
  const chip = El("span", "gg-chip " + (className || ""), text);
  if (title) chip.title = title;
  return chip;
}

function RenderSummary() {
  const mine = roster.people.filter((p) => p.group === "mine");
  const takers = mine.filter((p) => Verdict(p).kind === "takes").length;
  $("summaryLine").textContent = roster.studioName + " · " + FormatDate(roster.gameDate) + " · from " + roster.fileName + " · " +
    takers + " of " + mine.length + " of your people take an illegal gift";

  const stock = $("stock");
  stock.textContent = "";
  const owned = Object.entries(roster.inventory);
  const group = El("div", "gg-stock-group");
  group.appendChild(El("span", "gg-stock-label", "In stock"));
  if (!owned.length) group.appendChild(Chip("No gifts", "is-quiet"));
  for (const [key, amount] of owned) group.appendChild(Chip(ShortName(key) + " ×" + amount, data.gifts[key].illegal ? "is-illegal" : "is-legal", data.gifts[key].name));
  stock.appendChild(group);

  const unlocked = El("div", "gg-stock-group");
  unlocked.appendChild(El("span", "gg-stock-label", "Unlocked"));
  const perks = new Set(roster.perks);
  const open = Object.entries(data.gifts).filter(([, gift]) => perks.has(gift.perk));
  if (!open.length) unlocked.appendChild(Chip("None yet", "is-quiet"));
  for (const [key, gift] of open) unlocked.appendChild(Chip(ShortName(key), gift.illegal ? "is-illegal" : "is-legal", gift.name));
  const locked = Object.entries(data.gifts).filter(([, gift]) => !perks.has(gift.perk)).length;
  if (locked) unlocked.appendChild(El("span", "gg-stock-more", locked + " still locked"));
  stock.appendChild(unlocked);
}

function RenderWhoTakes() {
  const host = $("whoTakes");
  host.textContent = "";
  const mine = roster.people.filter((p) => p.group === "mine");
  const perks = new Set(roster.perks);
  const illegal = Object.entries(data.gifts).filter(([, gift]) => gift.illegal);
  const blocks = [];
  for (const [key, gift] of illegal) {
    const people = mine.filter((p) => Verdict(p).kind === "takes" && p.favorite === key);
    if (!people.length) continue;
    blocks.push({ key, gift, people });
  }
  blocks.sort((a, b) => b.people.length - a.people.length);

  for (const block of blocks) {
    const section = El("section", "gg-take");
    const head = El("div", "gg-take-head");
    head.appendChild(El("span", "gg-take-name", block.gift.name));
    head.appendChild(El("span", "gg-take-count", String(block.people.length)));
    const stock = Number(roster.inventory[block.key] || 0);
    if (stock) head.appendChild(Chip("×" + stock + " in stock", "is-stock"));
    else if (!perks.has(block.gift.perk)) head.appendChild(Chip("Locked", "is-quiet", "Not unlocked yet in your save"));
    section.appendChild(head);
    const names = El("div", "gg-take-people");
    for (const person of block.people.sort((a, b) => a.name.localeCompare(b.name))) {
      const button = El("button", "gg-person-chip", person.name);
      button.type = "button";
      button.title = person.role.name + (person.known === "favorite" ? " · already known in game" : " · still ??? in game");
      if (person.known === "favorite") button.classList.add("is-known");
      button.addEventListener("click", () => FocusPerson(person));
      names.appendChild(button);
    }
    section.appendChild(names);
    host.appendChild(section);
  }

  const agents = mine.filter((p) => Verdict(p).kind === "agent");
  const noFav = mine.filter((p) => Verdict(p).kind === "shadyNoFav");
  const legal = mine.filter((p) => Verdict(p).kind === "legal");
  const rest = El("div", "gg-take-rest");
  const line = (label, list, note) => {
    if (!list.length) return;
    const row = El("p", "gg-rest-line");
    row.appendChild(El("strong", "", label + " (" + list.length + ")"));
    row.appendChild(document.createTextNode(" " + note));
    rest.appendChild(row);
  };
  line("Security agents with a favorite", agents, "Use it in contract negotiations, where it counts 3×.");
  line("Shady, no favorite", noFav, "No illegal gift works. Legal gifts do.");
  line("Not shady", legal, "Legal gifts only.");
  host.appendChild(rest);
}

function GroupCounts() {
  for (const group of ["mine", "other", "free"]) {
    $("count-" + group).textContent = String(roster.people.filter((p) => p.group === group).length);
  }
}

function FillFilters() {
  const roles = new Map();
  for (const p of roster.people) roles.set(p.role.name, (roles.get(p.role.name) || 0) + 1);
  const roleSelect = $("filterRole");
  roleSelect.length = 1;
  for (const name of [...roles.keys()].sort()) {
    const option = El("option", "", name);
    option.value = name;
    roleSelect.appendChild(option);
  }
  const giftSelect = $("filterGift");
  giftSelect.length = 1;
  for (const [key, gift] of Object.entries(data.gifts)) {
    if (!gift.illegal) continue;
    const option = El("option", "", gift.name);
    option.value = key;
    giftSelect.appendChild(option);
  }
  const option = El("option", "", "No favorite");
  option.value = "__none";
  giftSelect.appendChild(option);
  const studioSelect = $("filterStudio");
  studioSelect.length = 1;
  for (const id of [...new Set(roster.people.filter((p) => p.group === "other").map((p) => p.studio))].sort()) {
    const opt = El("option", "", StudioName(id));
    opt.value = id;
    studioSelect.appendChild(opt);
  }
  roleSelect.value = view.role;
  $("filterVerdict").value = view.verdict;
  giftSelect.value = view.gift;
  studioSelect.value = view.studio;
  $("filterText").value = view.text;
}

function StudioName(id) {
  if (id === PLAYER_STUDIO) return roster.studioName;
  return data.studios[id] || id || "Free agent";
}

function Filtered() {
  const text = view.text.trim().toLowerCase();
  return roster.people.filter((p) => {
    if (p.group !== view.group) return false;
    if (text && !p.name.toLowerCase().includes(text)) return false;
    if (view.role && p.role.name !== view.role) return false;
    if (view.studio && view.group === "other" && p.studio !== view.studio) return false;
    if (view.gift === "__none" && p.favorite) return false;
    if (view.gift && view.gift !== "__none" && p.favorite !== view.gift) return false;
    const verdict = Verdict(p);
    if (view.verdict === "takes" && verdict.kind !== "takes") return false;
    if (view.verdict === "legal" && !["legal", "agent", "shadyNoFav"].includes(verdict.kind)) return false;
    if (view.verdict === "shadyNoFav" && verdict.kind !== "shadyNoFav") return false;
    if (view.verdict === "strikes" && !p.strikes) return false;
    if (view.verdict === "offended" && !p.offended) return false;
    return true;
  });
}

function SortValue(p) {
  switch (view.sort) {
    case "name": return p.name.toLowerCase();
    case "role": return p.role.name + " " + p.name;
    case "skill": return p.skill;
    case "studio": return StudioName(p.studio) + " " + p.name;
    case "shady": return (p.shady ? 0 : 1) + " " + p.name;
    case "favorite": return (p.favorite ? data.gifts[p.favorite].name : "~") + " " + p.name;
    case "attitude": return p.attitude;
    default: return Verdict(p).rank + " " + (p.favorite ? data.gifts[p.favorite].name : "") + " " + p.name;
  }
}

function RenderRoster() {
  const rows = $("rosterRows");
  rows.textContent = "";
  const list = Filtered().sort((a, b) => {
    const x = SortValue(a);
    const y = SortValue(b);
    return (x < y ? -1 : x > y ? 1 : 0) * view.dir;
  });
  document.querySelectorAll(".gg-table th").forEach((th) => th.removeAttribute("aria-sort"));
  document.querySelectorAll(".gg-table th button[data-sort]").forEach((button) => {
    const on = button.dataset.sort === view.sort;
    button.classList.toggle("is-sorted", on);
    button.dataset.dir = on ? (view.dir > 0 ? "asc" : "desc") : "";
    if (on) button.closest("th").setAttribute("aria-sort", view.dir > 0 ? "ascending" : "descending");
  });
  document.querySelector(".gg-table").classList.toggle("show-studio", view.group === "other");
  $("filterStudioWrap").hidden = view.group !== "other";
  $("rosterEmpty").hidden = list.length > 0;

  const legal = LegalGifts();
  const perks = new Set(roster.perks);
  const fragment = document.createDocumentFragment();
  for (const p of list) {
    const verdict = Verdict(p);
    const tr = El("tr", "gg-row is-" + verdict.kind);
    tr.dataset.person = String(p.id);

    const name = El("td", "gg-name");
    name.dataset.label = "Name";
    name.appendChild(El("span", "gg-name-text", p.name));
    const meta = El("span", "gg-traits");
    for (const trait of p.traits) meta.appendChild(Chip(data.traits[trait] || trait, trait === "JUNKIE" ? "is-addict" : "is-trait"));
    if (p.away) meta.appendChild(Chip(p.away, "is-away"));
    if (meta.childNodes.length) name.appendChild(meta);
    tr.appendChild(name);

    const role = El("td", "gg-role");
    role.dataset.label = "Role";
    role.appendChild(El("span", "gg-role-name", p.role.name));
    if (p.skill !== undefined) role.appendChild(SkillMeter(p));
    tr.appendChild(role);

    const studio = El("td", "col-studio", StudioName(p.studio));
    studio.dataset.label = "Studio";
    tr.appendChild(studio);

    const shady = El("td", "gg-shady");
    shady.dataset.label = "Shady";
    shady.appendChild(Chip(p.shady ? "Shady" : "No", p.shady ? "is-shady" : "is-quiet"));
    if (p.addict && !p.shady) shady.appendChild(Chip("Addict", "is-addict"));
    tr.appendChild(shady);

    const fav = El("td", "gg-fav");
    fav.dataset.label = "Favorite";
    if (p.favorite) {
      const gift = data.gifts[p.favorite];
      fav.appendChild(El("span", "gg-fav-name", gift.name));
      const known = El("span", "gg-known " + (p.known === "favorite" ? "is-known" : ""), p.known === "favorite" ? "Known in game" : "??? in game");
      fav.appendChild(known);
    } else {
      fav.appendChild(El("span", "gg-dash", "—"));
    }
    tr.appendChild(fav);

    const attitude = El("td", "gg-attitude");
    attitude.dataset.label = "Attitude";
    const bar = El("span", "gg-bar");
    const fill = El("span", "gg-bar-fill");
    fill.style.width = Math.max(0, Math.min(100, p.attitude * 100)) + "%";
    fill.style.background = ScaleColor(p.attitude);
    bar.appendChild(fill);
    attitude.appendChild(El("span", "gg-attitude-value", Percent(p.attitude)));
    attitude.appendChild(bar);
    attitude.title = "Attitude " + Percent(p.attitude) + " · Mood " + Percent(p.mood) + (p.type === TYPE.LIEUTENANT && p.shady ? " · illegal deals need 70%" : "");
    tr.appendChild(attitude);

    tr.appendChild(GiftsCell(p, verdict, legal, perks));
    fragment.appendChild(tr);
  }
  rows.appendChild(fragment);
}

// Skill the way the game shows it: stars out of 10, with the ceiling the skill can still grow to.
function SkillMeter(p) {
  const stars = p.skill * 10;
  const cap = Math.max(stars, p.limit * 10);
  const wrap = El("span", "gg-skill");
  wrap.title = "Skill " + stars.toFixed(1) + " of 10" + (cap > stars + 0.05 ? ", can grow to " + cap.toFixed(1) : ", at their limit");
  const line = El("span", "gg-skill-line");
  line.appendChild(El("span", "gg-skill-star", "★"));
  line.appendChild(El("span", "gg-skill-value", stars.toFixed(1)));
  if (cap > stars + 0.05) line.appendChild(El("span", "gg-skill-cap", "can reach " + Number(cap.toFixed(1))));
  else line.appendChild(El("span", "gg-skill-cap", "maxed"));
  wrap.appendChild(line);
  const bar = El("span", "gg-skill-bar");
  const room = El("span", "gg-skill-room");
  room.style.width = Math.min(100, cap * 10) + "%";
  const fill = El("span", "gg-skill-fill");
  fill.style.width = Math.min(100, stars * 10) + "%";
  bar.appendChild(room);
  bar.appendChild(fill);
  wrap.appendChild(bar);
  return wrap;
}

// Red at 0, white in the middle, green at 1: the same scale the calculator uses.
function ScaleColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const from = x <= 0.5 ? [248, 105, 107] : [255, 255, 255];
  const to = x <= 0.5 ? [255, 255, 255] : [99, 190, 123];
  const f = x <= 0.5 ? x * 2 : (x - 0.5) * 2;
  return "rgb(" + from.map((v, i) => Math.round(v + (to[i] - v) * f)).join(",") + ")";
}

// The answer to "what can I give them?": the verdict, their favorite if they take it, and the legal gifts.
// Legal gifts collapse to one chip while all of them are fresh; any that are limited are listed on their own.
function GiftsCell(p, verdict, legal, perks) {
  const cell = El("td", "gg-gifts");
  cell.dataset.label = "Gifts that help";
  const line = El("div", "gg-gift-chips");
  line.appendChild(Chip(verdict.text, "gg-verdict is-" + verdict.kind));
  if (p.offended) {
    cell.appendChild(line);
    cell.appendChild(El("span", "gg-note", verdict.note));
    return cell;
  }
  if (verdict.kind === "takes") {
    const gift = data.gifts[p.favorite];
    line.appendChild(Chip(ShortName(p.favorite) + " · no limit", "is-illegal is-best" + (perks.has(gift.perk) ? "" : " is-locked"),
      gift.name + ": +" + Percent(gift.moodBonus) + " mood, +" + Percent(gift.attitudeBonus) + " attitude. Illegal gifts never count as repeats." + (perks.has(gift.perk) ? "" : " Not unlocked yet.")));
  }
  const statuses = legal.map(([key, gift]) => ({ key, gift, status: LegalGiftStatus(p, key), unlocked: perks.has(gift.perk) }));
  const limited = statuses.filter((s) => s.status.left < data.rules.legalFullBoostTimes);
  const anyUnlocked = statuses.some((s) => s.unlocked);
  const legalTip = statuses.map((s) => ShortName(s.key) + " +" + Percent(s.gift.moodBonus) + " mood / +" + Percent(s.gift.attitudeBonus) + " attitude" + (s.unlocked ? "" : " (locked)")).join(String.fromCharCode(10));
  if (!limited.length) {
    line.appendChild(Chip("Any legal gift", "is-legal" + (anyUnlocked ? "" : " is-locked"), "Each gives its full boost twice a year:" + String.fromCharCode(10) + legalTip));
  } else {
    for (const s of limited) {
      const label = ShortName(s.key) + (s.status.left === 0 ? " · after " + FormatDate(s.status.until) : " · 1 left");
      const tip = s.gift.name + (s.status.left === 0 ? ": given twice in the last year, another one now costs 5% attitude." : ": one more full boost this year.");
      line.appendChild(Chip(label, "is-legal" + (s.status.left === 0 ? " is-used" : "") + (s.unlocked ? "" : " is-locked"), tip));
    }
    line.appendChild(Chip("Other legal gifts", "is-legal" + (anyUnlocked ? "" : " is-locked"), legalTip));
  }
  cell.appendChild(line);
  if (verdict.kind !== "takes") {
    const names = statuses.filter((s) => s.status.left > 0).map((s) => ShortName(s.key));
    if (names.length) cell.appendChild(El("span", "gg-legal-names", names.join(" · ") + (anyUnlocked ? "" : " (none unlocked yet)")));
  }
  if (verdict.note) cell.appendChild(El("span", "gg-note", verdict.note));
  if (p.strikes) {
    const left = data.rules.strikesToOffend - p.strikes;
    cell.appendChild(El("span", "gg-strikes", p.strikes + (p.strikes === 1 ? " strike" : " strikes") + ": " + left + " more wrong illegal gift" + (left === 1 ? "" : "s") + " offends"));
  }
  return cell;
}

function RenderAll() {
  $("welcome").hidden = Boolean(roster);
  $("app").hidden = !roster;
  if (!roster) return;
  RenderSummary();
  if (roster.people.length && roster.people[0].skill === undefined) Toast("Import your save again to see skill levels.");
  RenderWhoTakes();
  GroupCounts();
  FillFilters();
  ShowGroup(view.group);
}

function ShowGroup(group) {
  view.group = group;
  const index = ["mine", "other", "free"].indexOf(group);
  document.querySelectorAll(".gg-groups .segment").forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  $("tab-mine").parentElement.dataset.active = String(index);
  SaveView();
  RenderRoster();
}

function FocusPerson(person) {
  view.text = person.name;
  view.role = "";
  view.verdict = "";
  view.gift = "";
  view.studio = "";
  FillFilters();
  ShowGroup(person.group);
  const row = document.querySelector('.gg-row[data-person="' + person.id + '"]');
  if (row) {
    row.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.classList.add("is-flash");
    window.setTimeout(() => row.classList.remove("is-flash"), 1400);
  }
}

function SaveView() {
  WriteStored(VIEW_KEY, { group: view.group, sort: view.sort, dir: view.dir });
}

// ---------- events ----------

function InitEvents() {
  const input = $("saveFile");
  document.querySelectorAll("[data-import]").forEach((button) => button.addEventListener("click", () => input.click()));
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    const errorBox = roster ? $("importError") : $("welcomeError");
    errorBox.hidden = true;
    try {
      const text = (await file.text()).replace(/^﻿/, "");
      roster = BuildRoster(JSON.parse(text), file.name.replace(/\.json$/i, ""));
      WriteStored(ROSTER_KEY, roster);
      RenderAll();
      const mine = roster.people.filter((p) => p.group === "mine").length;
      Toast("Imported " + roster.fileName + ": " + roster.people.length + " people, " + mine + " at your studio.");
      Announce("Save imported.");
    } catch (error) {
      console.error(error);
      errorBox.textContent = "That file doesn't look like a Hollywood Animal save. Pick the .json file, not the _map or .png file with the same name.";
      errorBox.hidden = false;
    }
  });

  document.querySelectorAll(".gg-groups .segment").forEach((tab) => tab.addEventListener("click", () => ShowGroup(tab.dataset.group)));
  $("tab-mine").parentElement.addEventListener("keydown", (event) => {
    const order = ["mine", "other", "free"];
    const index = order.indexOf(view.group);
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: 2 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    ShowGroup(order[(next + 3) % 3]);
    $("tab-" + view.group).focus();
  });

  $("filterText").addEventListener("input", (event) => { view.text = event.target.value; RenderRoster(); });
  for (const [id, field] of [["filterRole", "role"], ["filterVerdict", "verdict"], ["filterGift", "gift"], ["filterStudio", "studio"]]) {
    $(id).addEventListener("change", (event) => { view[field] = event.target.value; RenderRoster(); });
  }
  document.querySelectorAll(".gg-table th button[data-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    view.dir = view.sort === key ? -view.dir : (key === "attitude" ? -1 : 1);
    view.sort = key;
    SaveView();
    RenderRoster();
  }));
}

// The sticky header's height, so the table's column titles stick just under it.
function InitHeaderHeight() {
  const header = document.querySelector(".site-header");
  const apply = () => document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  apply();
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(header);
}

document.addEventListener("DOMContentLoaded", async () => {
  InitHeaderHeight();
  view = Object.assign(view, ReadStored(VIEW_KEY, {}));
  InitEvents();
  try {
    const response = await fetch("db/GiftGuideData.json");
    data = await response.json();
    $("dataInfo").textContent = "Gift rules and names from " + data.source;
  } catch (error) {
    console.error(error);
    $("dataInfo").textContent = "Couldn't load the game data. Serve the page over http (see the README).";
    return;
  }
  roster = ReadStored(ROSTER_KEY, null);
  if (roster && !Array.isArray(roster.people)) roster = null;
  RenderAll();
});
