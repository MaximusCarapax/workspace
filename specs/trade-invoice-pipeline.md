# Trade Invoice Pipeline

## Overview
Parse construction specifications → categorize by trade → generate quotes/invoices

## Problem
Jason receives specs documents for residential projects with fixtures, fittings, and equipment. 
Different tradespeople need different items extracted and quoted.
Currently manual process - time consuming and error-prone.

## Solution
Automated pipeline:
1. **Extract** - Parse PDF specs, extract all items
2. **Categorize** - Group items by trade
3. **Generate** - Create trade-specific quotes

## Phase 1: Extraction & Categorization

### Input
- Specifications PDF (Schedule of Internal Selections)
- Format: Table with CODE, ITEMS, SUPPLIER, LOCATION, COMMENTS

### Processing
1. Parse PDF → extract text
2. Identify items by CODE patterns
3. Extract: code, description, manufacturer, finish, dimensions, location
4. Categorize by trade based on code prefix

### Trade Categories
| Trade | Code Patterns | Keywords |
|-------|---------------|----------|
| Glazier | GL*, MIR* | glass, mirror, shower, screen |
| Door Hardware | DF* | door, handle, lever, hinge, knob |
| Plumbing | TAP*, SAN*, WC*, BAS* | tap, toilet, basin, bath |
| Electrical | LT*, SW*, GPO* | light, switch, outlet, dimmer |
| Joinery | JN*, CAB* | cabinet, joinery, shelf |
| Appliances | AP*, OV* | oven, cooktop, rangehood |

### Output
```json
{
  "project": {
    "name": "41-43 Helens Road",
    "number": "000752",
    "date": "2025-12-29"
  },
  "trades": {
    "glazier": [
      {
        "code": "GL01",
        "description": "10mm Clear Toughened Glass",
        "dimensions": "1340 × 2400mm",
        "location": "Sauna",
        "quantity": 1
      }
    ],
    "door_hardware": [...],
    "plumbing": [...]
  }
}
```

## Phase 2: Quote Generation

### Input
- Categorized items JSON
- Trade template (company details, formatting)
- Price list (optional)

### Output
- Formatted quote PDF/Excel matching sample format
- Fields: Item description, dimensions, qty, price, GST, total

## Phase 3: Product (Stretch)
- Web interface
- Upload specs → auto-categorize → download quotes
- User accounts, saved templates, pricing integration

## Files
- `tools/specs-extractor.js` - Phase 1 extraction
- `tools/quote-generator.js` - Phase 2 generation
- `data/invoice-project/` - Sample files (gitignored)

## Status
- [ ] Phase 1: Specs extractor
- [ ] Phase 2: Quote generator
- [ ] Phase 3: Product

## Date
2026-02-05
