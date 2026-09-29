"""Extract pinned ECDICT exam lists: python scripts/prepare-wordlists.py path/to/ecdict.csv."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

REVISION = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
TAGS = {"cet4": "CET-4", "cet6": "CET-6", "ky": "考研", "ielts": "IELTS", "toefl": "TOEFL"}
LEVELS = {tag: {"zk", "gk", tag} for tag in TAGS}
LEVELS["cet6"].add("cet4")
terms = {tag: set() for tag in TAGS}
heads = {tag: set() for tag in TAGS}
with open(sys.argv[1], encoding="utf-8-sig", newline="") as source:
    for row in csv.DictReader(source):
        labels = set(row["tag"].split())
        tags = {tag for tag, included in LEVELS.items() if labels & included}
        if not tags:
            continue
        word = row["word"].strip().lower()
        if not word or len(word) > 150:
            continue
        forms = {word}
        for pair in row["exchange"].split("/"):
            key, _, value = pair.partition(":")
            if key in {"p", "d", "i", "3", "r", "t", "s"} and re.fullmatch(r"[a-z]+(?:[-' ][a-z]+)*", value):
                forms.add(value)
        for tag in tags:
            heads[tag].add(word)
            terms[tag].update(forms)
output = Path(__file__).resolve().parent.parent / "resources" / "wordlists"
output.mkdir(parents=True, exist_ok=True)
manifest = []
for tag, name in TAGS.items():
    data = ("\n".join(sorted(terms[tag])) + "\n").encode("utf-8")
    (output / f"{tag}.txt").write_bytes(data)
    manifest.append({"id": tag, "name": name, "headwords": len(heads[tag]), "count": len(terms[tag]), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
(output / "catalog.json").write_text(json.dumps({"sourceRevision": REVISION, "lists": manifest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
