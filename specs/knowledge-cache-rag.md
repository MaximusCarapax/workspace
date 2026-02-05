# Knowledge Cache RAG

**Feature:** #677  
**Status:** Spec  
**Author:** Maximus Carapax  
**Date:** 2026-02-05

## Problem

When I research something, the knowledge lives in:
1. The conversation (ephemeral, compacts away)
2. Session Memory RAG (captures the *discussion* about knowledge, not the knowledge itself)
3. Daily memory notes (if I remember to log it)

**What's missing:** A dedicated knowledge store that captures:
- Research findings
- Web content summaries
- Extracted facts
- Reusable insights

Currently, if Jason asks "what did you learn about contextual RAG?" I can search Session Memory and find our *conversation* about it, but not a clean, structured knowledge entry.

## Solution: Knowledge Cache

A separate RAG system for storing reusable knowledge:

### What gets stored:
1. **Research summaries** — When I research a topic, store the synthesized findings
2. **Web content** — Summaries of fetched pages (not raw HTML)
3. **Facts & entities** — Extracted structured data
4. **Tool outputs** — Results from research.js, web_fetch, etc.

### Schema

```sql
CREATE TABLE knowledge_cache (
    id INTEGER PRIMARY KEY,
    
    -- Core content
    title TEXT NOT NULL,
    summary TEXT NOT NULL,           -- Main knowledge content
    source_type TEXT NOT NULL,       -- 'research', 'web', 'conversation', 'manual'
    source_url TEXT,                 -- URL if from web
    source_session TEXT,             -- Session ID if from conversation
    
    -- Metadata
    topic_tags TEXT,                 -- JSON array of tags
    entities TEXT,                   -- JSON array of extracted entities
    confidence REAL DEFAULT 1.0,     -- How certain is this knowledge
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,             -- Optional TTL for time-sensitive info
    
    -- Status
    verified BOOLEAN DEFAULT FALSE,  -- Has this been fact-checked?
    superseded_by INTEGER,           -- If updated, points to newer entry
    
    -- Embedding
    embedding BLOB                   -- Vector for semantic search
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
    title, summary, topic_tags,
    content='knowledge_cache',
    content_rowid='id'
);
```

### API / Commands

```bash
# Add knowledge manually
node tools/knowledge.js add "title" --summary "content" --tags "tag1,tag2"

# Add from URL (fetch + summarize + store)
node tools/knowledge.js learn "https://example.com/article" --topic "AI"

# Search knowledge base
node tools/knowledge.js search "contextual retrieval"

# List recent knowledge
node tools/knowledge.js list --limit 10

# Get specific entry
node tools/knowledge.js get <id>

# Update/supersede entry
node tools/knowledge.js update <id> --summary "new info"

# Mark as verified
node tools/knowledge.js verify <id>
```

### Integration Points

1. **research.js** — Auto-save research findings to knowledge cache
2. **web_fetch** — Option to cache summaries of fetched pages
3. **Sub-agents** — Researcher can store findings directly
4. **Search** — Unified search across Session Memory + Knowledge Cache

### Automatic Knowledge Capture

When configured, automatically capture:
- `research.js` outputs → Knowledge entry with source_type='research'
- Important web fetches → Summarize and store with source_type='web'
- Marked conversation insights → Extract and store with source_type='conversation'

### Search Integration

Unified search command:
```bash
node tools/memory-search.js "query" --sources session,knowledge
```

Returns results from both Session Memory and Knowledge Cache, ranked by relevance.

## Cost Analysis

**Embedding:** Same as Session Memory (~$0.00001 per entry)
**Summarization:** If using Gemini for web summaries (~$0.0001 per page)

Minimal incremental cost.

## Implementation Plan

### Story 1: Knowledge Cache Schema + CRUD
- Create tables (knowledge_cache, knowledge_fts)
- Basic CLI: add, list, get, search
- Embedding generation

### Story 2: Automatic Capture
- Hook into research.js to auto-store findings
- Hook into web_fetch for content caching
- Configuration for what to capture

### Story 3: Unified Search
- Combined search across Session Memory + Knowledge Cache
- RRF scoring across both sources
- Single command interface

## Acceptance Criteria

- [ ] Knowledge entries can be added manually
- [ ] Knowledge can be searched semantically
- [ ] Research.js outputs auto-saved to knowledge cache
- [ ] Web fetches optionally cached with summaries
- [ ] Unified search works across both RAG systems
- [ ] Entries can be updated/superseded
- [ ] TTL/expiration works for time-sensitive data

## Relationship to Other Systems

| System | Stores | Use Case |
|--------|--------|----------|
| Session Memory | Conversations | "What did we discuss?" |
| Knowledge Cache | Facts & findings | "What do I know about X?" |
| Daily Memory | Events & decisions | "What happened today?" |
| MEMORY.md | Curated long-term | "Core identity & context" |

Knowledge Cache fills the gap between ephemeral conversations and curated long-term memory.

## Future: Knowledge Graph (#1101)

Knowledge Cache stores flat entries. Knowledge Graph (#1101) would add:
- Entity relationships (Person → Works At → Company)
- Inference capabilities
- Graph queries

Build Knowledge Cache first, Graph later.
