# Auto-Notes: Tool Instrumentation for Activity Logging

**Status:** Draft  
**Author:** Max  
**Date:** 2026-02-05  
**Pipeline:** #84  
**Priority:** High (improves sub-agent visibility)

---

## Problem

Sub-agents don't reliably add notes. We need automatic breadcrumb logging so we always have a trail of what happened, even when agents forget to summarize.

---

## Solution

Instrument our tools to auto-log to the activity table. Every tool usage creates a breadcrumb.

---

## What Gets Auto-Logged

| Tool | Log Entry |
|------|-----------|
| **aider** | `tool:aider` — files modified, model used |
| **web_search** | `tool:web_search` — query |
| **web_fetch** | `tool:web_fetch` — URL |
| **exec** | `tool:exec` — command (truncated), exit code |
| **gemini.js** | `tool:gemini` — tokens, cost |
| **research.js** | `tool:research` — query, sources count |
| **image-gen.js** | `tool:image_gen` — prompt, model |

---

## Activity Log Format

```javascript
{
  action: 'tool:aider',
  category: 'tool',
  description: 'Modified lib/db.js, tools/db.js (2 files)',
  source: 'subagent',  // inherited from context
  relatedId: 'pipeline:25',  // inherited from context
  metadata: {
    tool: 'aider',
    model: 'deepseek-chat',
    files: ['lib/db.js', 'tools/db.js'],
    duration_ms: 45000
  }
}
```

---

## Implementation

### 1. Create `lib/auto-log.js` wrapper

```javascript
const activity = require('./activity');

// Context set by orchestrator when spawning
let context = { source: 'main', relatedId: null };

function setContext(ctx) {
  context = { ...context, ...ctx };
}

function logTool(tool, description, metadata = {}) {
  activity.log(`tool:${tool}`, description, 'tool', {
    source: context.source,
    relatedId: context.relatedId,
    ...metadata
  });
}

module.exports = { setContext, logTool };
```

### 2. Instrument each tool

**aider wrapper (create `tools/aider-wrapper.js`):**
```javascript
const { logTool } = require('../lib/auto-log');
const { execSync } = require('child_process');

function runAider(files, instruction) {
  const start = Date.now();
  const result = execSync(`/home/node/.local/bin/aider --model deepseek/deepseek-chat --yes ${files.join(' ')}`, ...);
  const duration = Date.now() - start;
  
  logTool('aider', `Modified ${files.length} files: ${files.join(', ')}`, {
    files,
    model: 'deepseek-chat',
    duration_ms: duration
  });
  
  return result;
}
```

**web_search (modify existing or wrap):**
```javascript
// After search completes:
logTool('web_search', `Searched: "${query}"`, { 
  query, 
  results: results.length 
});
```

**exec (wrap common patterns):**
```javascript
logTool('exec', `Ran: ${command.substring(0, 100)}`, {
  command: command.substring(0, 500),
  exitCode,
  duration_ms
});
```

### 3. Context propagation

When Opus spawns a sub-agent:
```javascript
// In spawn task:
"Before starting, run: require('./lib/auto-log').setContext({ source: 'subagent', relatedId: 'pipeline:25' })"
```

Or set via environment variable that tools read.

---

## What Stays Manual

**Summary notes** — Agent still writes these:
```bash
node tools/db.js pipeline note 25 "Implemented PDF splitting, works up to 50 pages"
```

These go to both:
- `pipeline.notes` column (visible on feature)
- `activity` table (audit trail)

---

## View Examples

**Pipeline shows summaries only:**
```
$ pipeline show 25

📋 Pipeline Item #25
📝 Notes:
  2026-02-05 09:00 [subagent] Build complete: PDF extraction working
  2026-02-05 08:45 [subagent] Implemented split logic
  2026-02-05 08:30 [main] Starting build
```

**Activity shows everything (breadcrumbs + summaries):**
```
$ activity --related pipeline:25

📜 Activity Log
  09:00 [tool] tool:exec — Ran: node tools/invoice-extractor.js --test
  08:58 [tool] tool:aider — Modified tools/invoice-extractor.js
  08:55 [tool] tool:web_search — Searched: "pdftoppm options"
  08:45 [pipeline] pipeline_note — Implemented split logic
  08:30 [pipeline] pipeline_stage_changed — spec → building
```

---

## Acceptance Criteria

1. [ ] `lib/auto-log.js` created with `setContext()` and `logTool()`
2. [ ] aider wrapper logs tool usage
3. [ ] At least 2 other tools instrumented (exec, web_search)
4. [ ] Context propagates source + relatedId
5. [ ] Activity shows breadcrumbs with `--category tool`
6. [ ] Doesn't break existing tool functionality

---

## Future Enhancements

- Token/cost tracking per tool call
- Automatic summarization of breadcrumbs (end of session)
- Dashboard view of tool usage patterns
- Alert on unusual patterns (too many searches, etc.)

---

## Notes

Keep it lightweight. Auto-logging should never fail the actual tool operation — wrap in try/catch, log errors silently.
