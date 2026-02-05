# Invoice Extraction Pipeline

**Status:** Draft  
**Author:** Max  
**Date:** 2026-02-05  
**Pipeline:** #25  
**Priority:** High (client project)

---

## Problem

Construction documents (specs + architectural drawings) need to be converted into glazier quotes. Current challenges:
- Large PDF files (20+ MB) timeout on API calls
- Drawing dimensions are visual, not in text
- Need to match existing invoice format exactly
- Manual extraction is slow and error-prone

---

## Solution

A pipeline that:
1. Accepts PDFs from a Google Drive folder
2. Splits large PDFs into individual pages
3. Runs vision AI on each page to extract glazier items
4. Combines results, dedupes, and formats to match invoice structure

---

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Google Drive   │ ──► │  PDF Split   │ ──► │  Vision AI  │ ──► │   Combine    │
│  Input Folder   │     │  (per page)  │     │  (per page) │     │   + Format   │
└─────────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
       │                       │                    │                    │
       ▼                       ▼                    ▼                    ▼
   3 PDF files          PNG per page         JSON per page         Final JSON
   (specs, dwg1,        (< 5MB each)         (items found)         (invoice fmt)
    dwg2)
```

---

## Input

**Google Drive folder** containing up to 3 PDFs:
- `specifications.pdf` — Item codes, glass types, room schedules
- `drawings_1.pdf` — Architectural drawings (basement, ground floor)
- `drawings_2.pdf` — Architectural drawings (first floor)

**Trigger:** Manual or watch folder for changes

---

## Processing Steps

### Step 1: PDF Split
- Convert each PDF to individual page images (PNG)
- Resolution: 150 DPI (balance quality vs size)
- Output: `{original_name}_page_{n}.png`
- Target: < 5MB per image

### Step 2: Vision Extraction (per page)
- Send each page image to Gemini 2.5 Flash
- Extraction prompt (see below)
- Output: JSON array of items found on that page
- Log: tokens, cost, items found

### Step 3: Combine + Dedupe
- Merge all page results
- Dedupe by: floor + room + type + dimensions
- Handle quantity aggregation (QTY:48 etc.)
- Sort by floor → room

### Step 4: Format Output
- Match invoice structure:
  - Group by floor (Basement, Ground Floor, First Floor)
  - Separate Glass Balustrades section
  - Include all fields: room, type, code, specs, dimensions, qty, notes

---

## Vision Extraction Prompt

```
You are extracting glazier items from a construction document page.

EXTRACT ALL GLASS ITEMS including:
- Glass doors (ALL types - clear, reeded, frosted - not just frameless)
- Shower screens (note: front-only, corner, etc.)
- Mirrors (wall, cabinet, decorative)
- Glass balustrades (internal patch-fitted, external spigot-fitted)
- Glass panels and partitions

For EACH item found on this page, extract:
- floor: "Basement" | "Ground Floor" | "First Floor"
- room: Full room name (e.g., "WC", "B01 Bed Ensuite", "Powder Room")
- type: "Glass Door" | "Shower Screen" | "Mirror" | "Glass Balustrade" | "Glass Panel"
- code: Product code (GL01, GL02, MIR01, MIR02, GB07, etc.)
- specs: Glass specification (e.g., "10mm Clear Toughened", "6mm Grade A Safety Mirror")
- dimensions: In mm (W × H mm, W × D × H mm for corners, Ø mm for round)
- quantity: Number - CHECK FOR QTY NOTATIONS (QTY:2, QTY:48, etc.)
- notes: Installation notes (Front Only, Corner, Patch Fitted, etc.)

IMPORTANT:
- Basement has glass doors: WC, Sauna, Storage, Pool Equipment
- Some items have quantity multipliers (QTY:48 = 48 mirror tiles)
- Capture ALL glass items, not just frameless

Return JSON array:
[
  {"floor": "...", "room": "...", "type": "...", "code": "...", "specs": "...", "dimensions": "...", "quantity": 1, "notes": null}
]

If no glazier items on this page, return: []
```

---

## Output Format

```json
{
  "project": {
    "name": "41-43 HELENS ROAD, HAWTHORN EAST",
    "number": "000752",
    "extracted_at": "2026-02-05T08:00:00Z"
  },
  "items": [
    {
      "floor": "Basement",
      "room": "WC",
      "type": "Glass Door",
      "code": "GL02",
      "specs": "10mm Clear Reeded Toughened",
      "dimensions": "850 × 2400mm",
      "quantity": 1,
      "notes": null
    }
  ],
  "summary": {
    "total": 28,
    "by_floor": {"Basement": 8, "Ground Floor": 6, "First Floor": 14},
    "by_type": {"Mirror": 12, "Shower Screen": 6, "Glass Door": 5, "Glass Balustrade": 5}
  },
  "extraction_log": {
    "pages_processed": 45,
    "tokens_used": 150000,
    "cost_usd": 0.50
  }
}
```

---

## CLI Tool

```bash
# Full pipeline
node tools/invoice-extractor.js --input <drive-folder-id> --output extracted.json

# Or with local files
node tools/invoice-extractor.js --files "specs.pdf,drawings_1.pdf,drawings_2.pdf" --output extracted.json

# Options
--model gemini-flash    # Default: gemini-2.5-flash (cheapest)
--model gemini-pro      # Better accuracy, higher cost
--dpi 150               # Image resolution (default 150)
--verbose               # Show per-page progress
```

---

## Cost Estimate

| Component | Est. Pages | Tokens/Page | Cost |
|-----------|-----------|-------------|------|
| Specs PDF | 20 | 2,000 | $0.01 |
| Drawings 1 | 40 | 5,000 | $0.06 |
| Drawings 2 | 40 | 5,000 | $0.06 |
| **Total** | 100 | ~400k | **~$0.15** |

Using Gemini 2.5 Flash @ $0.30/M input tokens.

---

## Implementation Plan

### Phase 1: Core Pipeline (Builder)
- [ ] PDF → page images (pdftoppm)
- [ ] Vision extraction per page (OpenRouter API)
- [ ] Combine + dedupe logic
- [ ] Basic CLI

### Phase 2: Polish
- [ ] Google Drive integration (optional)
- [ ] Progress bar / verbose output
- [ ] Cost tracking to activity log
- [ ] Error handling for failed pages

---

## Acceptance Criteria

1. [ ] Extracts items from multi-page PDFs without timeout
2. [ ] Finds ALL basement glass doors (WC, Sauna, Storage, Pool Equipment)
3. [ ] Captures quantity multipliers (QTY:48 shoe room mirror)
4. [ ] Output matches invoice format structure
5. [ ] Total items ≥ invoice sample count (27+)
6. [ ] Cost < $0.50 per extraction run
7. [ ] CLI works with local files

---

## Test Data

Located in `data/invoice-project/`:
- `specifications.pdf` (1MB)
- `drawings_1.pdf` (23MB)
- `drawings_2.pdf` (22MB)
- `invoice_sample.pdf` (reference output)
- `extracted-glazier.json` (previous extraction - 22 items, incomplete)

---

## Notes

- Previous extraction found 22 items, invoice has ~27+
- Missed: Basement glass doors, some mirrors
- Root cause: Prompt excluded "standard hinged doors" + API timeout on large files
- This spec addresses both issues
