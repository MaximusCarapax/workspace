#!/usr/bin/env node
/**
 * Vision AI Extractor - Extract glazier items from construction documents
 * Uses OpenRouter API with Gemini 2.5 Pro for native PDF processing
 * 
 * Sends PDF files directly via base64 - no image conversion needed
 */

const fs = require('fs');
const path = require('path');

// Load OpenRouter API key
const OPENROUTER_KEY_PATH = path.join(process.env.HOME, '.openclaw/secrets/openrouter.json');
let OPENROUTER_API_KEY;
try {
  const config = JSON.parse(fs.readFileSync(OPENROUTER_KEY_PATH, 'utf-8'));
  OPENROUTER_API_KEY = config.api_key;
} catch (e) {
  console.error('Error: OpenRouter API key not found at', OPENROUTER_KEY_PATH);
  process.exit(1);
}

// Model options
const MODELS = {
  'gemini-flash': 'google/gemini-2.5-flash',        // $0.30/M in, $2.50/M out
  'gemini-pro': 'google/gemini-2.5-pro',            // $1.25/M in, $10/M out - default
  'claude-sonnet': 'anthropic/claude-sonnet-4',     // $3/M in, $15/M out
};

const EXTRACTION_PROMPT = `You are analyzing construction documents (specifications and architectural drawings) for a glazier quote.

Extract ALL items related to glazier work:
- Frameless glass shower screens
- Mirrors (wall-mounted)
- Glass balustrades (internal and external)
- Frameless glass doors (not standard hinged doors)
- Glass panels

For EACH item found, extract these fields:
- floor: "Basement", "Ground Floor", or "First Floor"
- location: Room name or area (e.g., "WC", "Master Ensuite", "Powder Room", "B01 Bed Ensuite")
- type: Item category - one of: "Shower Screen", "Mirror", "Glass Door", "Glass Balustrade"
- code: Product code if shown (e.g., "GL01", "GL02", "MIR01", "MIR02", "GB07")
- specs: Glass specifications (type, thickness, finish, e.g., "10mm Clear Toughened", "6mm Grade A Safety Mirror with Polymer Backing")
- dimensions: Size in mm (format: "W × H mm" for flat items, "W × D × H mm" for corners, "Ø diameter mm" for round)
- quantity: Number of items (look for "QTY:X" notation, default 1)
- notes: Special installation notes (e.g., "Front Only", "Corner", "Parallel Run", "Patch Fitted", "Spigot Fitted")

IMPORTANT INSTRUCTIONS:
1. Cross-reference BOTH the specifications document AND the architectural drawings
2. Look for dimension annotations near glass panels in the drawings
3. Room codes: B01=Bedroom 1, B02=Bedroom 2, ENS=Ensuite, WIR=Walk-in Robe, etc.
4. Include balustrades - internal (patch fitted) and external (spigot fitted)
5. Don't include door hardware, fixtures, or non-glass items
6. For mirrors, check if they're standard "MIR02" (6mm safety) or "MIR01" (decorative)

Return ONLY valid JSON in this exact format:
{
  "project": {
    "name": "Project address/name",
    "number": "Project number if shown"
  },
  "items": [
    {
      "floor": "Ground Floor",
      "location": "Powder Room",
      "type": "Mirror",
      "code": "MIR02",
      "specs": "6mm Grade A Safety Mirror with Polymer Backing",
      "dimensions": "1900 × 1600mm",
      "quantity": 1,
      "notes": null
    },
    {
      "floor": "Basement",
      "location": "Internal Staircase",
      "type": "Glass Balustrade",
      "code": "GB07",
      "specs": "12mm Patch Fitted Toughened Glass",
      "dimensions": "4800 × 1000mm",
      "quantity": 1,
      "notes": "Parallel Run"
    }
  ]
}`;

/**
 * Convert file to base64 data URL
 */
function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  return {
    base64: data.toString('base64'),
    mimeType,
    size: data.length
  };
}

/**
 * Send request to OpenRouter API
 */
async function callOpenRouter(model, messages, maxTokens = 16384) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://openclaw.ai',
      'X-Title': 'Vision Extractor'
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  
  // Log usage for cost tracking
  if (data.usage) {
    console.error(`  Tokens: ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`);
  }
  
  return data.choices[0].message.content;
}

/**
 * Extract using PDF files directly (native PDF support)
 * Can also include image files for supplementary data
 */
async function extractWithPDFs(pdfFiles, model, imageFiles = []) {
  console.error(`\nExtracting from ${pdfFiles.length} PDF(s) + ${imageFiles.length} image(s) using ${model}...`);
  
  const content = [
    { type: 'text', text: EXTRACTION_PROMPT }
  ];
  
  // Add PDF files as base64
  for (const pdfPath of pdfFiles) {
    const { base64, mimeType, size } = fileToBase64(pdfPath);
    console.error(`  Adding ${path.basename(pdfPath)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
    
    if (model.includes('gemini')) {
      // Gemini format via OpenRouter - file type with data URL
      content.push({
        type: 'file',
        file: {
          filename: path.basename(pdfPath),
          file_data: `data:${mimeType};base64,${base64}`
        }
      });
    } else if (model.includes('claude')) {
      // Claude format - document type
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64
        }
      });
    }
  }
  
  // Add image files (drawing pages, etc.)
  for (const imagePath of imageFiles) {
    const { base64, mimeType, size } = fileToBase64(imagePath);
    console.error(`  Adding ${path.basename(imagePath)} (${(size / 1024).toFixed(0)} KB)`);
    
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64}` }
    });
  }
  
  const messages = [{ role: 'user', content }];
  return callOpenRouter(model, messages);
}

/**
 * Parse JSON from AI response (handles markdown wrapping and truncation)
 */
function parseResponse(text) {
  let jsonStr = text;
  
  // Try to extract JSON from markdown code blocks
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || 
                    text.match(/```\s*([\s\S]*?)\s*```/);
  
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    // Handle truncated response - strip opening markdown if present
    jsonStr = text.replace(/^```json\s*/, '').replace(/^```\s*/, '');
  }
  
  // Try to parse as-is first
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    // Response may be truncated - try to repair by closing open structures
    console.error('Initial JSON parse failed, attempting repair...');
    
    // Find the last complete item in the array
    const itemsMatch = jsonStr.match(/"items"\s*:\s*\[/);
    if (itemsMatch) {
      // Find all complete item objects
      const items = [];
      const itemRegex = /\{\s*"floor"\s*:\s*"[^"]*"\s*,\s*"location"\s*:\s*"[^"]*"\s*,\s*"type"\s*:\s*"[^"]*"\s*,\s*"code"\s*:\s*"[^"]*"\s*,\s*"specs"\s*:\s*"[^"]*"\s*,\s*"dimensions"\s*:\s*"[^"]*"\s*,\s*"quantity"\s*:\s*\d+\s*,\s*"notes"\s*:\s*(?:null|"[^"]*")\s*\}/g;
      let match;
      while ((match = itemRegex.exec(jsonStr)) !== null) {
        try {
          items.push(JSON.parse(match[0]));
        } catch (itemErr) {
          // Skip malformed items
        }
      }
      
      // Extract project info
      const projectMatch = jsonStr.match(/"project"\s*:\s*\{[^}]+\}/);
      let project = { name: "Unknown", number: "Unknown" };
      if (projectMatch) {
        try {
          project = JSON.parse(projectMatch[0].replace(/"project"\s*:\s*/, ''));
        } catch (projErr) {
          // Use default
        }
      }
      
      if (items.length > 0) {
        console.error(`  Recovered ${items.length} complete items from truncated response`);
        return { project, items };
      }
    }
    
    console.error('Failed to parse or repair JSON:', e.message);
    console.error('Raw response (first 1500 chars):', text.substring(0, 1500));
    return null;
  }
}

/**
 * Main extraction function
 */
async function extract(pdfFiles, options = {}) {
  const {
    model = 'gemini-pro',  // Default to gemini-pro for native PDF support
    imageFiles = []        // Optional supplementary images
  } = options;
  
  const modelId = MODELS[model] || model;
  console.error(`\n📄 Vision Extractor - Glazier Items`);
  console.error(`   Model: ${modelId}`);
  console.error(`   PDFs: ${pdfFiles.join(', ')}`);
  if (imageFiles.length > 0) {
    console.error(`   Images: ${imageFiles.length} supplementary files`);
  }
  
  // Send PDFs directly via OpenRouter
  const response = await extractWithPDFs(pdfFiles, modelId, imageFiles);
  
  // Parse response
  const result = parseResponse(response);
  
  if (!result) {
    throw new Error('Failed to parse extraction result');
  }
  
  // Add metadata
  result.extracted_at = new Date().toISOString();
  result.model = modelId;
  result.source_files = pdfFiles.map(f => path.basename(f));
  
  // Add summary
  if (result.items) {
    const summary = {
      total: result.items.length,
      by_floor: {},
      by_type: {}
    };
    
    for (const item of result.items) {
      // Count by floor
      const floor = item.floor || 'Unknown';
      summary.by_floor[floor] = (summary.by_floor[floor] || 0) + (item.quantity || 1);
      
      // Count by type
      const type = item.type || 'Unknown';
      summary.by_type[type] = (summary.by_type[type] || 0) + (item.quantity || 1);
    }
    
    result.summary = summary;
  }
  
  return result;
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Vision AI Extractor - Extract glazier items from construction documents

Usage:
  node vision-extractor.js <pdf-files...> [options]

Options:
  -o, --output <file>   Output JSON file (default: stdout)
  -m, --model <name>    Model: gemini-pro (default), gemini-flash, claude-sonnet
  -i, --add-images <files>  Add image files (drawing pages, etc.) - comma-separated or glob
  -h, --help            Show this help

Models (via OpenRouter):
  gemini-pro      Google Gemini 2.5 Pro - native PDF support ($1.25/M input) [default]
  gemini-flash    Google Gemini 2.5 Flash - fast & cheap ($0.30/M input)
  claude-sonnet   Claude Sonnet 4 - best accuracy ($3/M input)

Examples:
  # Basic extraction (uses Gemini Pro by default)
  node vision-extractor.js specs.pdf drawings.pdf -o output.json

  # Add supplementary drawing images
  node vision-extractor.js specs.pdf -i "/tmp/drawings/*.png" -o output.json

  # Use cheaper Gemini Flash
  node vision-extractor.js *.pdf -m gemini-flash -o output.json
`);
    process.exit(0);
  }
  
  // Parse arguments
  const pdfFiles = [];
  const imageFiles = [];
  let outputFile = null;
  let model = 'gemini-pro';
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      outputFile = args[++i];
    } else if (arg === '-m' || arg === '--model') {
      model = args[++i];
    } else if (arg === '-i' || arg === '--add-images') {
      // Handle glob or comma-separated list of images
      const imgArg = args[++i];
      if (imgArg.includes('*')) {
        // Glob pattern
        const { execSync } = require('child_process');
        const matches = execSync(`ls ${imgArg} 2>/dev/null || true`, { encoding: 'utf-8' })
          .trim().split('\n').filter(f => f);
        imageFiles.push(...matches.map(f => path.resolve(f)));
      } else {
        // Comma-separated or single file
        imgArg.split(',').forEach(f => {
          const resolved = path.resolve(f.trim());
          if (fs.existsSync(resolved)) {
            imageFiles.push(resolved);
          }
        });
      }
    } else if (arg.endsWith('.pdf') && fs.existsSync(arg)) {
      pdfFiles.push(path.resolve(arg));
    } else if (!arg.startsWith('-')) {
      // Try as a file path
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) {
        if (resolved.endsWith('.pdf')) {
          pdfFiles.push(resolved);
        } else if (/\.(png|jpg|jpeg|webp)$/i.test(resolved)) {
          imageFiles.push(resolved);
        }
      } else {
        console.error(`Warning: File not found: ${arg}`);
      }
    }
  }
  
  if (pdfFiles.length === 0) {
    console.error('Error: No PDF files specified');
    process.exit(1);
  }
  
  try {
    const result = await extract(pdfFiles, { model, imageFiles });
    const json = JSON.stringify(result, null, 2);
    
    if (outputFile) {
      fs.writeFileSync(outputFile, json);
      console.error(`\n✅ Saved to ${outputFile}`);
      console.error(`   Found ${result.items?.length || 0} glazier items`);
      if (result.summary) {
        console.error(`   By floor: ${Object.entries(result.summary.by_floor).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
        console.error(`   By type: ${Object.entries(result.summary.by_type).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
      }
    } else {
      console.log(json);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

// Export for programmatic use
module.exports = { extract, MODELS };
