# Veterinary Clinical Reader — Anki Deck

Cloze deck converted from *The Veterinary Clinical Reader* (1st ed., 2026).

## Deck file

- [`Veterinary_Clinical_Reader.apkg`](Veterinary_Clinical_Reader.apkg) — import into Anki

## Conversion rules

Each book entry → one cloze note:

| Book text | Anki field |
|-----------|------------|
| Bold lead (recognition pattern before → / ?) | Visible front of `Text` |
| Bold answer terms after the lead | `{{cN::…}}` cloze deletions |
| Remaining non-bold / italic text (incl. *Not …* traps) | `Extra` (shown after reveal; `…` marks where answers sat) |

When an answer has no bold terms, the entire answer after the lead is a single cloze.

## Tags

Hierarchical tags mirror the book:

`Part_…::ChNN_…::Section_name`

Example: `Part_I_-_Canine::Ch01_Canine_-_Cardiovascular_and_Respiratory::Auscultation_and_congenital_heart_disease`

## Rebuild

```bash
pip install pymupdf genanki
python3 anki/parse_pdf.py   # requires the source PDF path in the script
python3 anki/build_deck.py
```

## Counts

About 3,200 notes (one per clinical entry), across 43 chapters.
