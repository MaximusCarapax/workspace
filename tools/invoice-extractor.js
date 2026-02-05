#!/usr/bin/env node
/**
 * Invoice Extraction Pipeline
 * 
 * Extracts glazier items from construction PDFs using vision AI.
 * Handles large PDFs by processing page-by-page to avoid timeouts.
 * 
 * Usage:
 *   node tools/invoice-extractor.js --files "specs.pdf,drawings_1.pdf" -o output.json
 *   node tools/invoice-extractor.js --files "data/invoice-project/*.pdf" -o extracted.json --verbose
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const glob = require('glob');

// ============ Configuration ============

const CONFIG = {
  dpi: 150,
  model: 'google/gemini-2.5-flash',  // OpenRouter model
  maxRetries: 3,
  retryDelayMs: 2000,
  tempDir: '/tmp/invoice-extractor',
  // Pricing per million tokens (OpenRouter)
  pricing: {
    input: 0.15,   // $0.15/M input
    output: 0.60   // $0.60/M output
  }
};

// ============ Credentials ============

function loadOpenRouterKey() {
  // Try .env first
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const match = env.match(/OPENROUTER_API_KEY=(.+)/m);
    if (match) return match[1].trim();
  }
  
  // Try secrets file
  try {
    const secrets = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, '.openclaw/secrets/openrouter.json')
    ));
    if (secrets.api_key) return secrets.api_key;
  } catch {}
  
  // Environment variable
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  
  throw new Error('OPENROUTER_API_KEY not found in .env, secrets, or environment');
}

// ============ Extraction Prompt ============

const EXTRACTION_PROMPT = `You are extracting glazier items from a construction document page.

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
- Look for tables, schedules, and annotations with glass specifications

Return ONLY a valid JSON array (no markdown, no explanation):
[
  {"floor": "...", "room": "...", "type": "...", "code": "...", "specs": "...", "dimensions": "...", "quantity": 1, "notes": null}
]

If no glazier items on this page, return: []`;

// ============ PDF Processing ============

function ensureTempDir() {
  if (!fs.existsSync(CONFIG.tempDir)) {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
  }
}

function cleanTempDir() {
  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
  }
}

function getPdfPageCount(pdfPath) {
  try {
    const result = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep Pages`, { encoding: 'utf8' });
    const match = result.match(/Pages:\s+(\d+)/);
    return match ? parseInt(match[1]) : 0;
  } catch {
    // Fallback: convert and count
    return 0;
  }
}

function splitPdfToImages(pdfPath, verbose = false) {
  const basename = path.basename(pdfPath, '.pdf').replace(/\s+/g, '_');
  const outputPrefix = path.join(CONFIG.tempDir, basename);
  
  if (verbose) console.error(`  Converting ${path.basename(pdfPath)} to images (${CONFIG.dpi} DPI)...`);
  
  try {
    // pdftoppm outputs: prefix-01.png, prefix-02.png, etc.
    execSync(`pdftoppm -png -r ${CONFIG.dpi} "${pdfPath}" "${outputPrefix}"`, {
      encoding: 'utf8',
      timeout: 300000  // 5 min timeout for large PDFs
    });
  } catch (err) {
    throw new Error(`Failed to convert PDF: ${err.message}`);
  }
  
  // Find all generated images
  const pattern = `${outputPrefix}-*.png`;
  const images = glob.sync(pattern).sort((a, b) => {
    const numA = parseInt(a.match(/-(\d+)\.png$/)?.[1] || 0);
    const numB = parseInt(b.match(/-(\d+)\.png$/)?.[1] || 0);
    return numA - numB;
  });
  
  if (verbose) console.error(`  Generated ${images.length} page images`);
  
  return images;
}

// ============ Vision API ============

async function extractFromImage(imagePath, apiKey, verbose = false) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = 'image/png';
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://openclaw.ai',
          'X-Title': 'Invoice Extractor'
        },
        body: JSON.stringify({
          model: CONFIG.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { 
                type: 'image_url', 
                image_url: { 
                  url: `data:${mimeType};base64,${base64Image}` 
                }
              }
            ]
          }],
          temperature: 0.1,  // Low temp for consistent extraction
          max_tokens: 4096
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        if (response.status === 429) {
          // Rate limit - wait and retry
          if (verbose) console.error(`    Rate limited, waiting ${CONFIG.retryDelayMs}ms...`);
          await sleep(CONFIG.retryDelayMs * attempt);
          continue;
        }
        throw new Error(`API error ${response.status}: ${error}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};
      
      // Parse JSON from response
      let items = [];
      try {
        // Handle potential markdown wrapping
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        items = JSON.parse(jsonStr);
        if (!Array.isArray(items)) items = [];
      } catch {
        // If not valid JSON, return empty
        if (verbose && content.length > 0) {
          console.error(`    Warning: Could not parse response as JSON`);
        }
      }
      
      return {
        items,
        tokens: {
          input: usage.prompt_tokens || 0,
          output: usage.completion_tokens || 0
        }
      };
      
    } catch (err) {
      if (attempt === CONFIG.maxRetries) {
        throw err;
      }
      if (verbose) console.error(`    Attempt ${attempt} failed: ${err.message}, retrying...`);
      await sleep(CONFIG.retryDelayMs * attempt);
    }
  }
  
  return { items: [], tokens: { input: 0, output: 0 } };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Deduplication ============

function dedupeItems(items) {
  const seen = new Map();
  
  for (const item of items) {
    // Create unique key from floor + room + type + dimensions
    const key = [
      (item.floor || '').toLowerCase(),
      (item.room || '').toLowerCase(),
      (item.type || '').toLowerCase(),
      (item.dimensions || '').toLowerCase().replace(/\s+/g, '')
    ].join('|');
    
    if (!seen.has(key)) {
      seen.set(key, item);
    } else {
      // If duplicate, take the one with more info
      const existing = seen.get(key);
      if ((item.code && !existing.code) || (item.specs && !existing.specs)) {
        seen.set(key, { ...existing, ...item });
      }
      // Aggregate quantities if both have them
      if (item.quantity > 1 && existing.quantity === 1) {
        existing.quantity = item.quantity;
      }
    }
  }
  
  return Array.from(seen.values());
}

function sortItems(items) {
  const floorOrder = { 'basement': 0, 'ground floor': 1, 'first floor': 2 };
  
  return items.sort((a, b) => {
    const floorA = floorOrder[(a.floor || '').toLowerCase()] ?? 99;
    const floorB = floorOrder[(b.floor || '').toLowerCase()] ?? 99;
    if (floorA !== floorB) return floorA - floorB;
    
    return (a.room || '').localeCompare(b.room || '');
  });
}

// ============ Output Formatting ============

function formatOutput(items, extractionLog) {
  const sorted = sortItems(dedupeItems(items));
  
  // Calculate summary
  const byFloor = {};
  const byType = {};
  
  for (const item of sorted) {
    const floor = item.floor || 'Unknown';
    const type = item.type || 'Unknown';
    byFloor[floor] = (byFloor[floor] || 0) + (item.quantity || 1);
    byType[type] = (byType[type] || 0) + (item.quantity || 1);
  }
  
  return {
    project: {
      name: "41-43 HELENS ROAD, HAWTHORN EAST",
      number: "000752",
      extracted_at: new Date().toISOString()
    },
    items: sorted,
    summary: {
      total: sorted.reduce((sum, i) => sum + (i.quantity || 1), 0),
      unique_items: sorted.length,
      by_floor: byFloor,
      by_type: byType
    },
    extraction_log: extractionLog
  };
}

// ============ CLI ============

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    files: [],
    output: null,
    verbose: false,
    dpi: CONFIG.dpi
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--files' && args[i + 1]) {
      // Support comma-separated or glob patterns
      const fileArg = args[++i];
      const parts = fileArg.split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.includes('*')) {
          options.files.push(...glob.sync(trimmed));
        } else if (fs.existsSync(trimmed)) {
          options.files.push(trimmed);
        } else {
          console.error(`Warning: File not found: ${trimmed}`);
        }
      }
    } else if ((arg === '-o' || arg === '--output') && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--dpi' && args[i + 1]) {
      options.dpi = parseInt(args[++i]);
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }
  
  return options;
}

function showHelp() {
  console.log(`
Invoice Extractor - Extract glazier items from construction PDFs

Usage:
  node tools/invoice-extractor.js --files "file1.pdf,file2.pdf" -o output.json
  node tools/invoice-extractor.js --files "data/*.pdf" -o output.json --verbose

Options:
  --files <paths>    Comma-separated PDF files or glob pattern
  -o, --output       Output JSON file (default: stdout)
  -v, --verbose      Show detailed progress
  --dpi <number>     Image resolution (default: 150)
  -h, --help         Show this help

Examples:
  node tools/invoice-extractor.js --files "specs.pdf,drawings.pdf" -o extracted.json
  node tools/invoice-extractor.js --files "data/invoice-project/*.pdf" -o out.json -v
`);
}

// ============ Main ============

async function main() {
  const options = parseArgs();
  
  if (options.files.length === 0) {
    console.error('Error: No PDF files specified. Use --files to provide input files.');
    showHelp();
    process.exit(1);
  }
  
  // Update config
  CONFIG.dpi = options.dpi;
  
  // Load API key
  let apiKey;
  try {
    apiKey = loadOpenRouterKey();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  
  const verbose = options.verbose;
  
  if (verbose) {
    console.error(`\n📄 Invoice Extractor`);
    console.error(`   Files: ${options.files.length}`);
    console.error(`   Model: ${CONFIG.model}`);
    console.error(`   DPI: ${CONFIG.dpi}\n`);
  }
  
  // Prepare
  ensureTempDir();
  
  const allItems = [];
  const log = {
    pages_processed: 0,
    tokens_input: 0,
    tokens_output: 0,
    cost_usd: 0,
    files: []
  };
  
  try {
    // Process each PDF
    for (const pdfPath of options.files) {
      if (verbose) console.error(`\n📁 Processing: ${path.basename(pdfPath)}`);
      
      const fileLog = {
        file: path.basename(pdfPath),
        pages: 0,
        items: 0
      };
      
      // Convert to images
      const images = splitPdfToImages(pdfPath, verbose);
      fileLog.pages = images.length;
      
      // Process each page
      for (let i = 0; i < images.length; i++) {
        const imagePath = images[i];
        const pageNum = i + 1;
        
        if (verbose) {
          process.stderr.write(`  Page ${pageNum}/${images.length}...`);
        }
        
        try {
          const result = await extractFromImage(imagePath, apiKey, verbose);
          
          log.pages_processed++;
          log.tokens_input += result.tokens.input;
          log.tokens_output += result.tokens.output;
          
          if (result.items.length > 0) {
            allItems.push(...result.items);
            fileLog.items += result.items.length;
            if (verbose) {
              console.error(` found ${result.items.length} items`);
            }
          } else {
            if (verbose) console.error(` no items`);
          }
          
          // Clean up image after processing
          fs.unlinkSync(imagePath);
          
        } catch (err) {
          if (verbose) console.error(` ERROR: ${err.message}`);
        }
        
        // Small delay between pages to avoid rate limits
        if (i < images.length - 1) {
          await sleep(200);
        }
      }
      
      log.files.push(fileLog);
      
      if (verbose) {
        console.error(`  ✓ ${fileLog.pages} pages, ${fileLog.items} items found`);
      }
    }
    
    // Calculate cost
    log.cost_usd = (
      (log.tokens_input * CONFIG.pricing.input / 1_000_000) +
      (log.tokens_output * CONFIG.pricing.output / 1_000_000)
    );
    
    // Format final output
    const output = formatOutput(allItems, {
      pages_processed: log.pages_processed,
      tokens_used: log.tokens_input + log.tokens_output,
      tokens_input: log.tokens_input,
      tokens_output: log.tokens_output,
      cost_usd: parseFloat(log.cost_usd.toFixed(4)),
      files: log.files
    });
    
    // Output results
    const jsonOutput = JSON.stringify(output, null, 2);
    
    if (options.output) {
      fs.writeFileSync(options.output, jsonOutput);
      if (verbose) {
        console.error(`\n✅ Results written to: ${options.output}`);
      }
    } else {
      console.log(jsonOutput);
    }
    
    // Summary
    if (verbose) {
      console.error(`\n📊 Summary:`);
      console.error(`   Total pages: ${log.pages_processed}`);
      console.error(`   Unique items: ${output.summary.unique_items}`);
      console.error(`   Total quantity: ${output.summary.total}`);
      console.error(`   Tokens: ${log.tokens_input.toLocaleString()} in / ${log.tokens_output.toLocaleString()} out`);
      console.error(`   Cost: $${log.cost_usd.toFixed(4)}`);
    }
    
  } finally {
    // Cleanup temp directory
    cleanTempDir();
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  cleanTempDir();
  process.exit(1);
});
