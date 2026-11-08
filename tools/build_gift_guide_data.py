"""Builds src/db/GiftGuideData.json for the Gift Guide page from a Hollywood Animal install.

The page reads a save file in the browser, but a save only stores ids (name ids, profession keys, trait ids, gift
numbers, studio ids). This file holds the English display names for those ids plus the gift rules, taken from the
game's own data so the page matches what the game shows.

Usage:  python tools/build_gift_guide_data.py "<game folder>/Hollywood Animal_Data"
"""
import json
import re
import sys
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def strings(path):
    data = load(path)
    return {key: data["locStrings"][index] for key, index in data["IdMap"].items()}


def clean(text):
    return re.sub(r"<[^>]+>", "", text or "").strip()


def main(data_dir):
    base = Path(data_dir) / "StreamingAssets" / "Data"
    loc = strings(base / "Localization" / "ENG" / "NON_EVENT.json")
    names = load(base / "Localization" / "ENG" / "CHARACTER_NAMES.json")
    presents = load(base / "Configs" / "Presents.json")
    offers = load(base / "Configs" / "NegotiationOffers.json")
    labels = load(base / "Configs" / "CharacterLabels.json")
    labels = labels.values() if isinstance(labels, dict) else labels
    offers = offers.values() if isinstance(offers, dict) else offers
    favorite_odds = {o["id"]: float(o.get("favoriteProbability", 0)) for o in offers if o.get("category") == 3}

    gifts = {}
    for key, present in presents.items():
        if present.get("category") not in (2, 3):   # 2 = legal ("white") gift, 3 = illegal ("black") gift
            continue
        perk = (present.get("condition") or "").replace("PERK:", "").strip()
        gifts[key] = {
            "intId": present["intID"],
            "name": clean(loc.get(key, key)),
            "illegal": present["category"] == 3,
            "perk": perk,
            "cost": present["cost"],
            "favoriteOdds": favorite_odds.get(key, 0),
            "moodBonus": float(present["moodBonus"]),
            "attitudeBonus": float(present["attitudeBonus"]),
            "moodPenalty": float(present["moodPenalty"]),
            "attitudePenalty": float(present["attitudePenalty"]),
        }

    trait_names = {}
    hidden_traits = []
    no_illegal_traits = []
    for label in labels:
        trait_names[label["id"]] = clean(loc.get(label["id"], "")) or label["id"].replace("_", " ").title()
        if label.get("IsHidden"):
            hidden_traits.append(label["id"])
        if (label.get("behaviour") or 0) & 3 == 3:   # LabelBehaviour.NoIllegalPresents
            no_illegal_traits.append(label["id"])

    professions = {}
    for key, text in loc.items():
        if key.startswith("PROFESSION_") and "_" not in key[len("PROFESSION_"):] and text:
            professions[key[len("PROFESSION_"):]] = clean(text)

    studios = {key: clean(loc[key]) for key in ("GB", "EM", "SU", "HE", "MA", "WA", "PA", "UN", "CO", "FO", "MG", "RK") if loc.get(key)}

    out = {
        "source": "Hollywood Animal game data (English)",
        "names": {"idMap": names["IdMap"], "strings": names["locStrings"]},
        "gifts": gifts,
        "drugGiftIds": [6, 7, 14],
        "rules": {
            "legalRepeatWindowDays": 365,
            "legalFullBoostTimes": 2,
            "legalRepeatAttitudePenalty": -0.05,
            "strikesToOffend": 3,
            "gameStart": "1929-01-01",
        },
        "traits": trait_names,
        "hiddenTraits": hidden_traits,
        "noIllegalGiftTraits": no_illegal_traits,
        "professions": professions,
        "studios": studios,
    }
    target = Path(__file__).resolve().parent.parent / "src" / "db" / "GiftGuideData.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", target, target.stat().st_size, "bytes;", len(gifts), "gifts,", len(professions), "professions,", len(studios), "studios")


if __name__ == "__main__":
    main(sys.argv[1])
