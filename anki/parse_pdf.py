#!/usr/bin/env python3
"""Parse The Veterinary Clinical Reader PDF into JSONL entries for Anki conversion."""

from __future__ import annotations

import json
import re
from pathlib import Path

import fitz  # pymupdf

PDF = Path(
    "/home/ubuntu/.cursor/projects/workspace/uploads/"
    "The_Veterinary_Clinical_Reader_Color_0f92.pdf"
)
OUT = Path("/workspace/anki/parsed_entries.jsonl")


def is_bold(span: dict) -> bool:
    return bool(span["flags"] & 2**4) or "Bold" in span.get("font", "")


def is_italic(span: dict) -> bool:
    return bool(span["flags"] & 2**1) or "Italic" in span.get("font", "")


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


def merge_spans(a: list[dict], b: list[dict], insert_space: bool = False) -> list[dict]:
    out = [dict(s) for s in a]
    if insert_space and out and b:
        out.append(
            {
                "text": " ",
                "bold": False,
                "italic": False,
                "synthetic": True,
                "page": b[0]["page"],
                "size": 9.6,
            }
        )
    for s in b:
        if out and needs_space(out[-1]["text"], s["text"]):
            out.append(
                {
                    "text": " ",
                    "bold": False,
                    "italic": False,
                    "synthetic": True,
                    "page": s["page"],
                    "size": 9.6,
                }
            )
        out.append(dict(s))
    return out


def buffer_text(spans: list[dict]) -> str:
    return "".join(s["text"] for s in spans)


def entry_looks_complete(spans: list[dict]) -> bool:
    t = buffer_text(spans).rstrip()
    if not t:
        return False
    return t.endswith((".", "!", "…"))


def main() -> None:
    doc = fitz.open(PDF)

    toc = doc.get_toc()
    parts: list[tuple[int, str]] = []
    chapters: list[tuple[int, str, str | None]] = []
    sections: list[tuple[int, str, str | None, str | None]] = []
    current_part = current_chapter = None
    for level, title, page in toc:
        title = title.strip()
        if level == 1 and title.startswith("Part "):
            current_part = title
            parts.append((page, title))
        elif level == 2:
            m = re.match(r"Chapter\s+(\d+)\s*(.*)", title)
            if m:
                num, rest = m.group(1), m.group(2).strip()
                title = f"Chapter {num} — {rest}" if rest else f"Chapter {num}"
            current_chapter = title
            chapters.append((page, title, current_part))
        elif level == 3:
            sections.append((page, title, current_chapter, current_part))

    def lookup_context(page_1based: int):
        part = chapter = section = None
        for p, t in parts:
            if p <= page_1based:
                part = t
            else:
                break
        for p, t, _ in chapters:
            if p <= page_1based:
                chapter = t
            else:
                break
        for p, t, _, _ in sections:
            if p <= page_1based:
                section = t
            else:
                break
        return part, chapter, section

    skip_footer = re.compile(
        r"^(The Veterinary Clinical Reader|Chapter\s+\d+)", re.I
    )

    def extract_line_items(page, page_no: int):
        lines_out = []
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            for line in b.get("lines", []):
                spans = []
                for span in line.get("spans", []):
                    text = span["text"]
                    if text == "":
                        continue
                    spans.append(
                        {
                            "text": text,
                            "bold": is_bold(span),
                            "italic": is_italic(span),
                            "size": round(span["size"], 1),
                            "page": page_no,
                        }
                    )
                if not spans:
                    continue
                line_text = "".join(s["text"] for s in spans).strip()
                if not line_text or line_text == "•":
                    continue
                if skip_footer.match(line_text):
                    continue
                if line_text.isdigit() and all(s["size"] <= 9.0 for s in spans):
                    continue
                if re.match(r"^CHAPTER\s+\d+$", line_text, re.I):
                    continue
                lines_out.append(spans)
        return lines_out

    def line_kind(spans):
        mx = max(s["size"] for s in spans)
        if mx >= 14.0:
            return "chapter_title"
        if mx >= 10.0 and any(s["bold"] for s in spans) and mx < 14:
            return "section"
        if 9.3 <= mx <= 10.0:
            return "body"
        return "other"

    def line_starts_bold(spans):
        for s in spans:
            if s["text"].strip() == "":
                continue
            return bool(s["bold"])
        return False

    all_lines = []
    for pi in range(7, doc.page_count):
        for spans in extract_line_items(doc[pi], pi + 1):
            all_lines.append(spans)

    entries = []
    current_part, current_chapter, current_section = lookup_context(8)
    buf: list[dict] = []

    def flush():
        nonlocal buf
        if not buf:
            return
        text = buffer_text(buf).strip()
        if not text:
            buf = []
            return
        entries.append(
            {
                "spans": buf,
                "part": current_part,
                "chapter": current_chapter,
                "section": current_section,
                "page": next(s["page"] for s in buf if "page" in s),
            }
        )
        buf = []

    for spans in all_lines:
        kind = line_kind(spans)
        if kind == "chapter_title":
            flush()
            page = spans[0]["page"]
            current_part, current_chapter, current_section = lookup_context(page)
            current_section = None
            continue
        if kind == "section":
            flush()
            current_section = re.sub(
                r"\s+", " ", "".join(s["text"] for s in spans)
            ).strip()
            page = spans[0]["page"]
            current_part, current_chapter, _ = lookup_context(page)
            continue
        if kind != "body":
            continue

        if not buf:
            buf = merge_spans([], spans)
            continue

        if line_starts_bold(spans):
            prev = None
            for s in reversed(buf):
                if s.get("synthetic"):
                    continue
                if s["text"].strip():
                    prev = s
                    break
            if prev and prev["bold"]:
                buf = merge_spans(buf, spans, insert_space=True)
            elif not entry_looks_complete(buf):
                buf = merge_spans(buf, spans, insert_space=True)
            else:
                flush()
                buf = merge_spans([], spans)
        else:
            buf = merge_spans(buf, spans, insert_space=True)

    flush()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        for e in entries:
            compressed = []
            for s in e["spans"]:
                if (
                    compressed
                    and compressed[-1]["bold"] == s["bold"]
                    and compressed[-1]["italic"] == s["italic"]
                    and not compressed[-1].get("synthetic")
                    and not s.get("synthetic")
                ):
                    compressed[-1]["text"] += s["text"]
                elif compressed and compressed[-1].get("synthetic") and s.get(
                    "synthetic"
                ):
                    continue
                else:
                    compressed.append(
                        {
                            "text": s["text"],
                            "bold": s["bold"],
                            "italic": s["italic"],
                            "synthetic": s.get("synthetic", False),
                        }
                    )
            rec = {
                "page": e["page"],
                "part": e["part"],
                "chapter": e["chapter"],
                "section": e["section"],
                "spans": compressed,
                "plain": re.sub(r" +", " ", buffer_text(e["spans"])).strip(),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"Wrote {len(entries)} entries to {OUT}")


if __name__ == "__main__":
    main()
