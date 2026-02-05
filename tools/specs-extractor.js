#!/usr/bin/env node
/**
 * Specs Extractor - Parse construction specifications PDF
 * Extracts items, categorizes by trade, outputs JSON
 */

const { execSync } = require('child_process');
const fs = require('fs');

// Trade categorization based on code prefixes
const TRADE_MAPPING = {
  'DF': 'door_hardware',
  'MD': 'moulding',
  'SW': 'electrical',
  'LT': 'electrical',
  'GPO': 'electrical',
  'GP': 'electrical',
  'PB': 'electrical',
  'PS': 'electrical',
  'SM': 'smart_home',
  'BA': 'plumbing',
  'SH': 'plumbing',
  'TP': 'plumbing',
  'BN': 'plumbing',
  'BS': 'plumbing',
  'TW': 'plumbing',
  'FW': 'plumbing',
  'AC': 'bathroom_accessories',
  'SS': 'glazier',
  'MR': 'glazier',
  'GL': 'glazier',
  'SR': 'staircase',
  'AP': 'appliances',
  'OV': 'appliances',
  'DW': 'appliances',
  'RH': 'appliances',
  'FX': 'fixtures',
  'FP': 'fixtures',
  'MC': 'miscellaneous'
};

function extractPdfText(pdfPath) {
  try {
    // Use -raw mode for cleaner extraction of table-based PDFs
    const text = execSync(`pdftotext -raw "${pdfPath}" -`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });
    return text;
  } catch (err) {
    console.error('Failed to extract PDF text:', err.message);
    process.exit(1);
  }
}

function parseProjectInfo(text) {
  const project = { name: '', number: '', date: '', issue: '' };
  
  const projectMatch = text.match(/PROJECT\s*\n\s*([^\n]+)/i);
  if (projectMatch) project.name = projectMatch[1].trim();
  
  const numberMatch = text.match(/Project Number:\s*(\d+)/i);
  if (numberMatch) project.number = numberMatch[1];
  
  const dateMatch = text.match(/Date:\s*([\d.]+)/i);
  if (dateMatch) project.date = dateMatch[1];
  
  const issueMatch = text.match(/Issue:\s*([^\n]+)/i);
  if (issueMatch) project.issue = issueMatch[1].trim();
  
  return project;
}

function parseItems(text) {
  const items = [];
  const lines = text.split('\n');
  
  // Code pattern: 2-3 letters + 2 digits, alone on a line or at start
  const codeRegex = /^([A-Z]{2,3}\d{2})$/;
  
  let currentItem = null;
  let collectingFor = null; // which field we're collecting multi-line content for
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Skip page headers and table headers
    if (line.includes('PROPOSED NEW RESIDENTIAL') || 
        line.match(/^Page \d+/) ||
        line === 'CODE ITEMS SUPPLIER LOCATION IMAGE COMMENTS REVISIONS') {
      continue;
    }
    
    // Check for new item code
    const codeMatch = line.match(codeRegex);
    if (codeMatch) {
      // Save previous item
      if (currentItem) {
        cleanupItem(currentItem);
        items.push(currentItem);
      }
      
      currentItem = {
        code: codeMatch[1],
        name: '',
        manufacturer: '',
        product: '',
        finish: '',
        size: '',
        color: '',
        supplier_url: '',
        locations: [],
        raw_lines: []
      };
      collectingFor = 'name'; // Next lines are the item name
      continue;
    }
    
    if (!currentItem) continue;
    
    // Store raw line for debugging
    currentItem.raw_lines.push(line);
    
    // Parse structured fields
    if (line.startsWith('Manufacturer:')) {
      currentItem.manufacturer = line.replace('Manufacturer:', '').trim();
      collectingFor = null;
    } else if (line.startsWith('Product:')) {
      currentItem.product = line.replace('Product:', '').trim();
      collectingFor = 'product';
    } else if (line.startsWith('Finish:')) {
      currentItem.finish = line.replace('Finish:', '').trim();
      collectingFor = null;
    } else if (line.startsWith('Size:')) {
      currentItem.size = line.replace('Size:', '').trim();
      collectingFor = 'size';
    } else if (line.match(/^Colou?r:/)) {
      currentItem.color = line.replace(/Colou?r:/, '').trim();
      collectingFor = null;
    } else if (line.startsWith('Supplier:')) {
      const url = line.replace('Supplier:', '').trim();
      if (url.startsWith('http')) {
        currentItem.supplier_url = url;
      }
      collectingFor = 'url';
    } else if (line.startsWith('http')) {
      // Continuation of URL
      if (currentItem.supplier_url) {
        currentItem.supplier_url += line;
      } else {
        currentItem.supplier_url = line;
      }
    } else if (line.startsWith('@')) {
      // Location - clean up any trailing comment markers
      const loc = line.replace('@', '').trim()
        .split(/\s+•/)[0]  // Remove anything after bullet
        .split(/\s{2,}/)[0] // Remove anything after double space
        .trim();
      if (loc && !loc.match(/^[•R\d]/) && loc.length > 1) {
        currentItem.locations.push(loc);
      }
      collectingFor = null;
    } else if (line.startsWith('•') || line.startsWith('Or similar')) {
      // Comments or end marker - ignore
      collectingFor = null;
    } else if (line.match(/^R\d$/)) {
      // Revision marker - ignore
      collectingFor = null;
    } else if (collectingFor === 'name' && !currentItem.name) {
      // First content line after code is the name
      currentItem.name = line;
      collectingFor = null;
    } else if (collectingFor === 'product' && !line.match(/^(Finish|Size|Colou?r|Supplier|@|•)/)) {
      // Continue product name
      currentItem.product += ' ' + line;
    } else if (collectingFor === 'size' && !line.match(/^(Finish|Colou?r|Supplier|@|•)/)) {
      // Continue size info
      currentItem.size += ' ' + line;
    }
  }
  
  // Don't forget last item
  if (currentItem) {
    cleanupItem(currentItem);
    items.push(currentItem);
  }
  
  return items;
}

function cleanupItem(item) {
  // Clean up product name
  if (item.product) {
    item.product = item.product
      .replace(/\s+/g, ' ')
      .replace(/(Finish|Size|Colou?r|Supplier|@|•).*$/, '')
      .trim();
  }
  
  // If no product but has name, use name as product
  if (!item.product && item.name) {
    item.product = item.name;
  }
  
  // Clean URL - remove anything after space or common suffixes
  if (item.supplier_url) {
    item.supplier_url = item.supplier_url
      .split(/\s/)[0]
      .replace(/[•@].*$/, '')
      .trim();
  }
  
  // Remove raw_lines from output
  delete item.raw_lines;
  
  // Remove empty fields
  Object.keys(item).forEach(key => {
    if (!item[key] || (Array.isArray(item[key]) && item[key].length === 0)) {
      delete item[key];
    }
  });
  
  // Add quantity based on locations
  item.quantity = item.locations ? item.locations.length : 1;
  if (item.quantity === 0) item.quantity = 1;
}

function categorizeByTrade(items) {
  const trades = {};
  
  for (const item of items) {
    const prefixMatch = item.code.match(/^([A-Z]+)/);
    if (!prefixMatch) continue;
    
    const prefix = prefixMatch[1];
    const trade = TRADE_MAPPING[prefix] || 'other';
    
    if (!trades[trade]) {
      trades[trade] = [];
    }
    
    trades[trade].push(item);
  }
  
  return trades;
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Specs Extractor - Parse construction specifications PDF

Usage:
  node specs-extractor.js <pdf-file> [options]

Options:
  --output, -o <file>   Output JSON file (default: stdout)
  --trade <name>        Filter to specific trade
  --list-trades         List all trade categories
  --summary             Show summary only
  --help, -h            Show this help

Examples:
  node specs-extractor.js specifications.pdf
  node specs-extractor.js specs.pdf --trade glazier
  node specs-extractor.js specs.pdf -o extracted.json
`);
    process.exit(0);
  }
  
  if (args.includes('--list-trades')) {
    console.log('\nTrade Categories:');
    [...new Set(Object.values(TRADE_MAPPING))].forEach(t => console.log(`  - ${t}`));
    process.exit(0);
  }
  
  const pdfPath = args[0];
  if (!fs.existsSync(pdfPath)) {
    console.error(`Error: File not found: ${pdfPath}`);
    process.exit(1);
  }
  
  const outputIdx = args.findIndex(a => a === '--output' || a === '-o');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;
  
  const tradeIdx = args.findIndex(a => a === '--trade');
  const tradeFilter = tradeIdx !== -1 ? args[tradeIdx + 1] : null;
  
  const summaryMode = args.includes('--summary');
  
  console.error('Extracting PDF text...');
  const text = extractPdfText(pdfPath);
  
  console.error('Parsing project info...');
  const project = parseProjectInfo(text);
  
  console.error('Parsing items...');
  const items = parseItems(text);
  console.error(`Found ${items.length} items`);
  
  console.error('Categorizing by trade...');
  let trades = categorizeByTrade(items);
  
  if (tradeFilter) {
    if (trades[tradeFilter]) {
      trades = { [tradeFilter]: trades[tradeFilter] };
    } else {
      console.error(`Trade not found: ${tradeFilter}`);
      console.error('Available trades:', Object.keys(trades).join(', '));
      process.exit(1);
    }
  }
  
  const result = {
    project,
    extracted_at: new Date().toISOString(),
    summary: {
      total_items: items.length,
      trades: Object.fromEntries(Object.entries(trades).map(([k, v]) => [k, v.length]))
    },
    trades
  };
  
  if (summaryMode) {
    console.log('\n📋 Specifications Summary');
    console.log('='.repeat(50));
    console.log(`Project: ${project.name}`);
    console.log(`Number:  ${project.number}`);
    console.log(`Date:    ${project.date}`);
    console.log(`Issue:   ${project.issue}`);
    console.log('');
    console.log('Items by Trade:');
    Object.entries(result.summary.trades).forEach(([trade, count]) => {
      console.log(`  ${trade.padEnd(25)} ${count} items`);
    });
    console.log('-'.repeat(50));
    console.log(`  ${'TOTAL'.padEnd(25)} ${items.length} items`);
    process.exit(0);
  }
  
  const json = JSON.stringify(result, null, 2);
  
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.error(`\n✅ Saved to ${outputFile}`);
  } else {
    console.log(json);
  }
}

main();
