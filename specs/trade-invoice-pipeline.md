# Trade Invoice Pipeline

## Overview
Vision AI extracts glazier items from construction documents → generates formatted quotes.

## Problem
Client receives specs + drawings for residential projects. Needs qty and sizes for:
- Frameless showers
- Mirrors
- Glass balustrades
- Frameless glass doors

Currently manual process - time consuming and error-prone.

## Solution

### Phase 1: Vision AI Extraction
**Input:** specs.pdf + drawings.pdf(s)

**Process:**
1. Convert PDF pages to images
2. Feed to vision AI with extraction prompt
3. AI returns structured data

**Prompt template:**
```
Extract all glazier items from these construction documents:
- Frameless showers (glass panels, screens)
- Mirrors
- Glass balustrades
- Frameless glass doors

For each item provide:
- Location (room name)
- Floor (Basement/Ground/First)
- Item type
- Code (if shown, e.g., GL01, MIR02)
- Specifications (glass type, thickness, finish)
- Dimensions (W × H or W × D × H in mm)
- Quantity

Return as JSON array.
```

**Output:**
```json
{
  "project": {
    "name": "41-43 Helens Road",
    "number": "000752"
  },
  "items": [
    {
      "floor": "Basement",
      "location": "WC",
      "type": "Glass Door",
      "code": "GL02",
      "specs": "10mm Clear Reeded Toughened",
      "dimensions": "850 × 2400mm",
      "quantity": 1
    }
  ]
}
```

### Phase 2: Quote Generator
**Input:** Extracted JSON + company template

**Output:** Formatted quote PDF matching invoice_sample.pdf format
- Grouped by floor (B, GF, FF, GB)
- Each floor = line item with bundled price
- Item descriptions with room + code + specs + dimensions
- GST calculation

### Phase 3: Product (Stretch)
- Web interface for upload
- Multiple trade templates
- Price list integration

## Files
- `tools/vision-extractor.js` - Phase 1 extraction
- `tools/quote-generator.js` - Phase 2 generation
- `data/invoice-project/` - Sample files (gitignored)

## Vision AI Selection
Researching best model for architectural drawing accuracy.
Candidates: GPT-4o, Claude Vision, Gemini Pro Vision

## Status
- [x] Phase 1a: Text-based specs extractor (deprecated)
- [ ] Phase 1b: Vision AI extractor ← CURRENT
- [ ] Phase 2: Quote generator
- [ ] Phase 3: Product

## Date
2026-02-05
