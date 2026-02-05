# Spec: Contextual Session Memory RAG (#7)

## Problem
When context compacts or I start a new session, I lose conversation history. I can't recall what we discussed, decisions made, or context established. Manual memory files help but are incomplete and inconsistent.

## Goal
Searchable memory of ALL past conversations. Semantic search ("what did we discuss about content strategy") returns relevant conversation chunks with full context.

## Requirements

### Must Have
- Index all session transcripts (sessions/*.jsonl)
- Semantic search across conversations
- Return chunks with enough context to be useful
- Filter by: date range, speaker (Jason vs me), topic
- Fast enough for real-time use during conversations

### Should Have
- Auto-detect topics/tags from conversation content
- Track conversation "threads" (related discussions across sessions)
- Incremental indexing (don't re-embed everything on each run)

### Won't Have (for now)
- Real-time indexing during conversation (batch is fine)
- Multi-user support (just Jason and me)

---

## Technical Design

### 1. Transcript Chunking (#631)

**Input:** Session JSONL files (user/assistant turns)

**Chunking Strategy:**
- Chunk by **conversation exchange** (user message + assistant response = 1 chunk)
- Max chunk size: ~500 tokens (fits well with embedding models)
- If exchange exceeds limit, split but keep overlap for context
- Preserve turn boundaries (never split mid-message)

**Metadata per chunk:**
```json
{
  "session_id": "uuid",
  "chunk_index": 0,
  "timestamp": "2026-02-05T10:30:00Z",
  "speakers": ["user", "assistant"],
  "token_count": 487,
  "topic_tags": ["content-strategy", "x-posting"],  // auto-extracted
  "has_decision": true,  // detected decision/conclusion
  "has_action": false    // detected action item
}
```

**Topic Extraction:**
- Use lightweight LLM call (Gemini Flash) to extract 1-3 topic tags per chunk
- Cache extraction results (don't re-extract on re-index)
- Fallback: keyword extraction if LLM unavailable

### 2. Contextual Embedding Pipeline (#635)

**Context Prepending:**
Before embedding each chunk, prepend situational context:
```
[Session from February 5, 2026 at 10:30 AM Melbourne time]
[Participants: Jason Wu and Max (AI assistant)]
[Topics: content strategy, X posting frequency]
[Context: Discussion about social media approach]

<actual conversation chunk here>
```

This gives the embedding semantic understanding of WHEN/WHO/WHAT.

**Embedding Model:**
- `text-embedding-3-small` via OpenAI
- 1536 dimensions
- ~$0.02 per 1M tokens (very cheap)

**Storage Schema (SQLite):**
```sql
CREATE TABLE session_chunks (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  timestamp DATETIME NOT NULL,
  speakers TEXT,  -- JSON array
  topic_tags TEXT,  -- JSON array
  has_decision INTEGER DEFAULT 0,
  has_action INTEGER DEFAULT 0,
  content TEXT NOT NULL,  -- original chunk
  context_content TEXT NOT NULL,  -- with prepended context
  token_count INTEGER,
  embedding BLOB,  -- 1536 floats as binary
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, chunk_index)
);

CREATE INDEX idx_chunks_timestamp ON session_chunks(timestamp);
CREATE INDEX idx_chunks_session ON session_chunks(session_id);
```

**Vector Search:**
- Use `sqlite-vec` extension from day 1 (not deferred)
- Proper vector indexing scales to 100k+ chunks
- Avoids O(n) linear search bottleneck

```sql
CREATE VIRTUAL TABLE session_embeddings USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[1536]
);
```

### 3. Session Search Tool (#639)

**Interface:**
```javascript
session_search({
  query: "content posting frequency discussion",
  filters: {
    after: "2026-02-01",
    before: "2026-02-05", 
    speaker: "user",  // optional: filter to Jason's messages
    topics: ["content-strategy"],  // optional
    has_decision: true  // optional
  },
  limit: 5
})
```

**Returns:**
```javascript
{
  results: [
    {
      session_id: "abc-123",
      timestamp: "2026-02-03T14:30:00Z",
      topics: ["content-strategy", "x-posting"],
      relevance_score: 0.87,
      content: "User: How many posts per day should we do?\nAssistant: Based on the research...",
      context: "This was during a longer discussion about X growth strategy"
    }
  ]
}
```

**Integration with existing tools:**
- New tool: `session_search` (similar to `memory_search`)
- Can be called during conversations when I need to recall
- Could auto-trigger on certain queries ("what did we discuss about X?")

---

## Error Handling & Validation

### Data Validation
Before processing any session file:
```javascript
function validateSessionFile(filepath) {
  // 1. Check file exists and is readable
  // 2. Validate JSONL format (each line valid JSON)
  // 3. Check required fields: role, content, timestamp
  // 4. Validate timestamp formats
  // 5. Ensure UTF-8 encoding
  // Return: { valid: bool, errors: [], warnings: [] }
}
```

### Error Types
```javascript
class SessionMemoryError extends Error {
  constructor(type, message, details = {}, recoverable = true) {
    super(message);
    this.type = type;  // PARSE_ERROR, EMBEDDING_FAILED, STORAGE_ERROR, VALIDATION_ERROR
    this.details = details;
    this.recoverable = recoverable;
  }
}
```

### Recovery Strategy
- **Parse errors:** Skip malformed lines, log warning, continue
- **Embedding failures:** Retry 3x with backoff, then skip chunk and flag for later
- **Storage errors:** Rollback transaction, alert, pause indexing
- **Validation errors:** Quarantine file, log details, continue with others

### Large Session Handling
Sessions with 500+ exchanges:
- Process in batches of 100 chunks
- Yield between batches (prevent blocking)
- Track progress for resumability
- Cap single session at 2000 chunks (warn if exceeded)

---

## Change Detection & Incremental Indexing

### State Tracking
```javascript
// Stored in SQLite: index_state table
{
  session_id: "abc-123",
  file_path: "sessions/abc-123.jsonl",
  file_hash: "sha256:...",  // Detect modifications
  last_indexed: "2026-02-05T10:30:00Z",
  chunk_count: 45,
  status: "complete"  // complete | partial | failed
}
```

### Indexing Logic
1. Scan session directory
2. For each file:
   - If new (not in state): full index
   - If modified (hash changed): re-index
   - If unchanged: skip
3. Track progress for crash recovery
4. Clean up orphaned chunks (deleted sessions)

### CLI Support
```bash
session-memory.js index --all           # Full reindex
session-memory.js index --new           # Only new/modified
session-memory.js index --session <id>  # Single session
session-memory.js index --status        # Show index state
```

---

## Performance Monitoring

### Metrics Tracked
```javascript
const metrics = {
  // Indexing
  totalChunks: 15420,
  totalSessions: 127,
  lastIndexed: "2026-02-05T14:30:00Z",
  avgIndexTimePerSession: "2.3s",
  
  // Search
  avgSearchLatency: "150ms",
  searchCount24h: 47,
  
  // Health
  failedChunks: 3,
  quarantinedSessions: 0,
  storageUsedMB: 245
};
```

### Health Check
```bash
session-memory.js health
# Output: OK | DEGRADED | ERROR with details
```

---

## Implementation Plan

### Story #631: Transcript Chunking + Metadata
1. Build session file validator (JSONL format, required fields, encoding)
2. Build chunker that reads session JSONL files
3. Implement exchange-based chunking with size limits
4. Add large session handling (batching, 2000 chunk cap)
5. Add topic extraction (Gemini Flash) with keyword fallback
6. Store chunks in SQLite table with proper schema
7. Implement error handling (skip bad lines, quarantine bad files)
8. CLI: `tools/session-memory.js chunk [--session <id>] [--all] [--validate-only]`

### Story #635: Contextual Embedding Pipeline
1. Set up sqlite-vec extension for vector storage
2. Build context prepender with rich metadata
3. Implement embedding generation (OpenAI) with retry logic
4. Implement change detection (file hash tracking)
5. Build incremental indexing (new/modified only)
6. Add progress tracking for crash recovery
7. CLI: `tools/session-memory.js embed [--session <id>] [--all] [--status]`

### Story #639: Session Search Tool
1. Implement vector similarity search using sqlite-vec
2. Add metadata filtering (date, speaker, topic, has_decision)
3. Build result formatting with context snippets
4. Create tool interface for agent use
5. Add performance monitoring (latency tracking)
6. Add health check command
7. CLI: `tools/session-memory.js search "query" [--filters]`
8. CLI: `tools/session-memory.js health`

---

## Cost Estimate

**One-time indexing (existing sessions):**
- ~50 sessions × ~100 chunks avg = 5,000 chunks
- Topic extraction: ~2.5M tokens × $0.10/M = $0.25
- Embeddings: ~2.5M tokens × $0.02/M = $0.05
- **Total: ~$0.30**

**Ongoing (per day):**
- ~5-10 new sessions × 50 chunks = 500 chunks
- Topic extraction: ~$0.025/day
- Embeddings: ~$0.005/day
- **Total: ~$0.03/day = ~$1/month**

Very cheap. Not a concern.

---

## Success Criteria

1. Can search "what did Jason say about posting frequency" and get relevant results
2. Results include enough context to be useful without loading full session
3. Search completes in <2 seconds
4. Incremental indexing works (new sessions indexed without full rebuild)
5. Filters work correctly (date, topic, speaker)

---

## Open Questions

1. **Auto-trigger search?** Should I automatically search when I detect a recall question, or only on explicit use?
   - Recommendation: Start explicit, add auto-trigger later

2. **Retention policy?** Keep all history forever or prune old sessions?
   - Recommendation: Keep everything for now, add retention later if storage becomes issue

3. **Real-time vs batch?** Index after session ends or during?
   - Recommendation: Batch (end of session or daily cron), simpler and sufficient

---

## Reviewer Feedback (Incorporated)

- ✅ sqlite-vec from day 1 (not deferred)
- ✅ Error handling + validation strategy
- ✅ Change detection for incremental indexing
- ✅ Large session handling (batching, caps)
- ✅ Performance monitoring hooks
- ⏸️ Backup strategy (deferred - manual exports sufficient)
- ⏸️ Full concurrent access (deferred - single writer for now)

---

*Spec version: 1.1*
*Author: Max*
*Reviewed by: Sonnet (spec-reviewer)*
*Date: 2026-02-05*
