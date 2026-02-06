# Friction Capture & Synthesis Guide

Tools for systematically capturing friction points and ideas during work, then analyzing patterns to suggest improvements.

## Quick Start

### Log Friction or Ideas
```bash
# Basic friction logging
node tools/log-friction.js "Description of friction"

# With detailed options
node tools/log-friction.js "CLI commands too slow" --impact high --category performance --type friction

# Capture ideas
node tools/log-friction.js "Add voice commands" --type idea --impact low --category ux

# With suggested fix
node tools/log-friction.js "Poor autocomplete" --impact medium --category ux --fix "Update IDE plugins"
```

### View Entries
```bash
# List recent entries
node tools/log-friction.js list

# Filter by type
node tools/log-friction.js list --type friction
node tools/log-friction.js list --type idea

# Extend time range
node tools/log-friction.js list --days 30

# Show statistics
node tools/log-friction.js stats
```

### Generate Analysis
```bash
# Create synthesis report
node tools/synthesize-friction.js synthesize

# Analyze longer period
node tools/synthesize-friction.js synthesize --days 30

# Show report immediately
node tools/synthesize-friction.js synthesize --show

# View existing reports
node tools/synthesize-friction.js list-reports
node tools/synthesize-friction.js show latest
node tools/synthesize-friction.js show 2026-02-06
```

## File Structure
```
memory/friction/
├── 2026-02-06.json          # Daily friction/idea entries
├── 2026-02-07.json          # Next day's entries...
├── synthesis-2026-02-06.md  # AI analysis report
└── synthesis-2026-02-07.md  # Next report...
```

## Entry Schema
Each entry contains:
- `timestamp`: ISO 8601 timestamp
- `description`: What happened
- `type`: "friction" or "idea"  
- `impact`: "high", "medium", or "low"
- `category`: "ux", "performance", "workflow", or "other"
- `suggested_fix`: Optional solution (null if not provided)

## AI Analysis Features
The synthesis tool uses Gemini to provide:
- **Pattern Analysis**: Recurring themes and systemic issues
- **Priority Matrix**: Ranked by impact, frequency, and ease of resolution
- **Solution Recommendations**: Root cause analysis with actionable steps
- **Quick Wins**: < 2 hour improvements
- **Trend Analysis**: Changes over time (with sufficient data)
- **Feature Ideas**: Alignment with friction points
- **Process Improvements**: Workflow changes to prevent recurrence

## Integration Tips
- **Zero-friction logging**: Keep commands short and memorable
- **Daily habit**: Log friction as soon as you notice it
- **Weekly synthesis**: Run analysis every 7-14 days to spot patterns
- **Team sharing**: Share synthesis reports with your team
- **Action items**: Actually implement the suggested quick wins!

## Examples

### High-Impact Friction
```bash
node tools/log-friction.js "Build takes 5+ minutes, blocks development flow" \
  --impact high --category performance --fix "Optimize webpack config, add incremental builds"
```

### Process Idea
```bash
node tools/log-friction.js "Automated friction detection via IDE plugin" \
  --type idea --impact medium --category workflow
```

### UX Issue
```bash
node tools/log-friction.js "Error messages don't include line numbers" \
  --impact medium --category ux --fix "Update logger to include stack trace context"
```

## Story #2382: ✅ COMPLETE

Both tools are implemented and tested:
- ✅ `tools/log-friction.js` - CLI friction/idea capture 
- ✅ `tools/synthesize-friction.js` - Daily synthesis with Gemini analysis
- ✅ Storage in `memory/friction/YYYY-MM-DD.json`
- ✅ Support for ideas with `--type idea`
- ✅ Zero-friction logging achieved
- ✅ Both tools tested and working correctly