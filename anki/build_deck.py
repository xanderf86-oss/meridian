#!/usr/bin/env python3
"""Build Anki cloze deck from parsed Veterinary Clinical Reader entries."""

from __future__ import annotations

import hashlib
import html
import json
import re
from collections import Counter
from pathlib import Path

import genanki

ENTRIES = Path("/workspace/anki/parsed_entries.jsonl")
OUT_APKG = Path("/workspace/anki/Veterinary_Clinical_Reader.apkg")
OUT_ARTIFACT = Path("/opt/cursor/artifacts/Veterinary_Clinical_Reader.apkg")
OUT_SUMMARY = Path("/workspace/anki/deck_summary.json")

MODEL_ID = 1607392319
DECK_ID = 2059400110


def sanitize_tag(s: str | None) -> str:
    if not s:
        return "Unknown"
    s = s.replace("—", "-").replace("–", "-")
    s = re.sub(r"[&/]", " and ", s)
    s = re.sub(r"[^\w\s\-.]+", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", "_", s.strip())
    s = re.sub(r"_+", "_", s)
    return s[:120] or "Unknown"


def part_tag(part: str | None) -> str:
    return sanitize_tag(part or "Unknown_Part")


def chapter_tag(chapter: str | None) -> str:
    if not chapter:
        return "Unknown_Chapter"
    m = re.match(r"Chapter\s+(\d+)\s*[—\-]*\s*(.*)", chapter)
    if m:
        num = int(m.group(1))
        rest = m.group(2).strip()
        return sanitize_tag(f"Ch{num:02d}_{rest}" if rest else f"Ch{num:02d}")
    return sanitize_tag(chapter)


def section_tag(section: str | None) -> str:
    return sanitize_tag(section or "General")


def collapse_spaces(s: str) -> str:
    s = re.sub(r" +", " ", s)
    s = re.sub(r"\s+([,.;:)\]])", r"\1", s)
    s = re.sub(r"([(\[])\s+", r"\1", s)
    return s.strip()


def is_ws(span: dict) -> bool:
    return not span["text"].strip()


def needs_space(prev: str, nxt: str) -> bool:
    if not prev or not nxt:
        return False
    if prev[-1].isspace() or nxt[0].isspace():
        return False
    if nxt[0] in ",.;:)]}%":
        return False
    if prev[-1] in "([{\"'" or prev[-1] in "“‘":
        return False
    return True


def merge_style_runs(spans: list[dict]) -> list[dict]:
    """Merge adjacent spans of same bold/italic; whitespace glues same-style runs."""
    runs: list[dict] = []
    for s in spans:
        if is_ws(s):
            if runs and not runs[-1]["text"].endswith(" "):
                runs[-1]["text"] += " "
            continue
        bold, italic = s["bold"], s["italic"]
        if runs and runs[-1]["bold"] == bold and runs[-1]["italic"] == italic:
            prev = runs[-1]["text"]
            t = s["text"]
            if needs_space(prev, t):
                runs[-1]["text"] += " "
            runs[-1]["text"] += t
        else:
            if runs and needs_space(runs[-1]["text"], s["text"]):
                runs[-1]["text"] += " "
            runs.append({"text": s["text"], "bold": bold, "italic": italic})
    for r in runs:
        r["text"] = collapse_spaces(r["text"])
    return [r for r in runs if r["text"]]


def escape_cloze_inner(s: str) -> str:
    s = html.escape(s, quote=False)
    # Avoid breaking Anki cloze delimiter
    s = s.replace("::", "∶∶")
    return s


def build_card(entry: dict) -> dict:
    runs = merge_style_runs(entry["spans"])

    lead = ""
    rest = runs
    if runs and runs[0]["bold"]:
        lead = runs[0]["text"]
        rest = runs[1:]

    bold_answers = [r["text"] for r in rest if r["bold"]]

    if bold_answers:
        clozes = [
            f"{{{{c{i}::{escape_cloze_inner(a)}}}}}"
            for i, a in enumerate(bold_answers, 1)
        ]
        text = collapse_spaces(html.escape(lead, quote=False) + " " + " ".join(clozes))
        n_clozes = len(bold_answers)
        # Extra: non-bold/italic text only; ellipsis marks where cloze answers sat
        extra_parts = []
        for r in rest:
            if r["bold"]:
                extra_parts.append("…")
            else:
                t = html.escape(r["text"], quote=False)
                extra_parts.append(f"<i>{t}</i>" if r["italic"] else t)
        extra = collapse_spaces(" ".join(extra_parts))
        extra = re.sub(r"\s+([,.;:)\]])", r"\1", extra)
        extra = re.sub(r"…(?:\s*…)+", "…", extra)
    else:
        answer = collapse_spaces(" ".join(r["text"] for r in rest))
        if not answer:
            answer = lead
            lead = ""
        text = collapse_spaces(
            (html.escape(lead, quote=False) + " " if lead else "")
            + f"{{{{c1::{escape_cloze_inner(answer)}}}}}"
        )
        extra = ""
        n_clozes = 1

    tags = [
        part_tag(entry["part"]),
        chapter_tag(entry["chapter"]),
        section_tag(entry["section"]),
    ]
    hier = "::".join(tags)

    return {
        "text": text,
        "extra": extra,
        "tags": [hier, tags[0], f"{tags[0]}::{tags[1]}"],
        "part": entry["part"],
        "chapter": entry["chapter"],
        "section": entry["section"],
        "page": entry["page"],
        "plain": entry["plain"],
        "n_clozes": n_clozes,
        "lead": lead,
    }


def main() -> None:
    entries = [json.loads(line) for line in ENTRIES.open()]
    cards = [build_card(e) for e in entries]

    css = """
.card {
  font-family: "Liberation Serif", "Times New Roman", Times, serif;
  font-size: 18px;
  line-height: 1.45;
  color: #1a1a1a;
  background: #faf9f6;
  padding: 1.2em 1.4em;
}
.cloze { font-weight: 700; color: #0b5f4a; }
.extra {
  margin-top: 1em;
  padding-top: 0.75em;
  border-top: 1px solid #d9d3c7;
  color: #333;
  font-size: 0.95em;
}
.nightMode .card { background: #1c1c1c; color: #eee; }
.nightMode .cloze { color: #7dceb6; }
.nightMode .extra { border-top-color: #444; color: #ccc; }
"""

    model = genanki.Model(
        MODEL_ID,
        "Vet Clinical Reader Cloze",
        fields=[
            {"name": "Text"},
            {"name": "Extra"},
            {"name": "Source"},
        ],
        templates=[
            {
                "name": "Cloze",
                "qfmt": "{{cloze:Text}}",
                "afmt": (
                    '{{cloze:Text}}<div class="extra">{{Extra}}</div>'
                    '<div class="extra" style="font-size:0.8em;opacity:0.75">{{Source}}</div>'
                ),
            }
        ],
        css=css,
        model_type=genanki.Model.CLOZE,
    )

    deck = genanki.Deck(DECK_ID, "Veterinary Clinical Reader")

    for card in cards:
        source = html.escape(f"p.{card['page']} · {card['section'] or ''}", quote=False)
        note = genanki.Note(
            model=model,
            fields=[card["text"], card["extra"], source],
            tags=card["tags"],
            guid=hashlib.sha1(f"vcr|{card['plain']}".encode()).hexdigest()[:10],
        )
        deck.add_note(note)

    OUT_APKG.parent.mkdir(parents=True, exist_ok=True)
    OUT_ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    pkg = genanki.Package(deck)
    pkg.write_to_file(str(OUT_APKG))
    pkg.write_to_file(str(OUT_ARTIFACT))

    summary = {
        "notes": len(cards),
        "cloze_deletions": sum(c["n_clozes"] for c in cards),
        "parts": dict(Counter(c["part"] for c in cards)),
        "chapters": len(Counter(c["chapter"] for c in cards)),
        "sections": len(Counter(c["section"] for c in cards)),
        "apkg": str(OUT_APKG),
        "samples": [
            {
                "text": c["text"],
                "extra": c["extra"],
                "tags": c["tags"][0],
                "page": c["page"],
            }
            for c in cards[:8]
        ],
    }
    OUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False))

    print("notes", len(cards), "clozes", sum(c["n_clozes"] for c in cards))
    print("size", OUT_APKG.stat().st_size)
    has_arrow = sum(1 for c in cards if ("→" in c["lead"] or "?" in c["lead"]))
    print("leads with → or ?", has_arrow, "/", len(cards))
    print("leads ending comma", sum(1 for c in cards if c["lead"].rstrip().endswith(",")))
    for c in cards[:6]:
        print("=" * 60)
        print("TAGS:", c["tags"][0])
        print("TEXT:", c["text"][:300])
        print("EXTRA:", c["extra"][:300])


if __name__ == "__main__":
    main()
