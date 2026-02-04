# Second Brain Upgrade: Embeddings & Semantic Search

**Status:** Draft  
**Created:** 2025-02-04  
**Author:** Spec Agent

---

## Goal

Transform the current memory system from keyword-based retrieval into a semantic search system that understands meaning, enabling queries like "what did we discuss about X?" with relevant context surfacing automatically.

---

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| F1 | Generate embeddings for all memory entries | Must |
| F2 | Semantic search returning ranked results by relevance | Must |
| F3 | Auto-extract memories from session transcripts | Must |
| F4 | Hybrid search (semantic + keyword fallback) | Should |
| F5 | Automatic embedding refresh on content change | Should |
| F6 | Memory deduplication via similarity detection | Could |
| F7 | Context window packing (retrieve relevant memories for prompts) | Must |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| N1 | Search latency | <200ms for 10k memories |
| N2 | Embedding cost | <$0.01 per 1000 memories |
| N3 | Storage overhead | <50MB for 10k memories |
| N4 | No external dependencies beyond API calls | Required |

---

## Acceptance Criteria

### Semantic Search
- [ ] `memory_search "what did Jason think about the agent idea"` returns relevant memories even if exact words don't match
- [ ] Results ranked by semantic similarity score (0-1)
- [ ] Falls back to keyword search when embeddings unavailable

### Auto-Capture
- [ ] After session ends, automatically extracts: decisions, facts, preferences, lessons
- [ ] Skips trivial/routine content (greetings, acknowledgments)
- [ ] Tags extracted memories with source session ID
- [ ] Rate: extracts 0-10 memories per typical session

### Context Surfacing
- [ ] Before responding, agent can query "relevant context for: {user message}"
- [ ] Returns top-k most relevant memories
- [ ] Packable into prompt within token budget

---

## Technical Approach

### Embedding Model Selection
**Primary:** `text-embedding-3-small` (OpenAI)
- 1536 dimensions, $0.02/1M tokens (~$0.00002 per memory)
- High quality, battle-tested

**Fallback:** Gemini embedding or local model (if cost becomes concern)

### Storage Strategy
**Option A (Recommended):** SQLite + BLOB columns
- Store embeddings as binary blobs in existing `memory` table
- Add `embedding BLOB` column
- Use application-level cosine similarity (fast enough for <50k records)
- Zero new dependencies

**Option B:** sqlite-vec extension
- Native vector search in SQLite
- Faster for larger datasets
- Adds native dependency complexity

### Auto-Extraction Pipeline
```
Session Transcript → Chunking → LLM Extraction → Embedding → Storage
```
- Use cheap model (Gemini Flash) for extraction
- Prompt: "Extract facts, decisions, preferences, lessons. Skip trivia."
- Run async after session completion

### Search Interface
```javascript
// Semantic search
db.memory.search("agent architecture discussion", { limit: 5 })
// → [{ id, content, score: 0.87, category, created_at }, ...]

// Context retrieval for prompt
db.memory.getContext("user message here", { maxTokens: 2000 })
// → "Relevant context:\n- Memory 1\n- Memory 2..."
```

---

## Tasks Breakdown

### Phase 1: Foundation (MVP)
| Task | Effort |
|------|--------|
| Add `embedding` BLOB column to memory table | 0.5h |
| Create embedding generation function (OpenAI API) | 1h |
| Implement cosine similarity search | 1h |
| CLI: `node tools/db.js memory search "query"` | 1h |
| Backfill embeddings for existing memories | 0.5h |

### Phase 2: Auto-Capture
| Task | Effort |
|------|--------|
| Session transcript access/parsing | 1h |
| LLM extraction prompt engineering | 1h |
| Auto-extraction hook (post-session trigger) | 1h |
| Deduplication check before insert | 1h |

### Phase 3: Integration
| Task | Effort |
|------|--------|
| Context retrieval helper for prompts | 1h |
| Hybrid search (semantic + keyword) | 1h |
| Memory refresh on content update | 0.5h |
| Documentation & testing | 1h |

---

## Estimated Effort

| Phase | Hours | Calendar |
|-------|-------|----------|
| Phase 1: Foundation | 4h | 1 day |
| Phase 2: Auto-Capture | 4h | 1 day |
| Phase 3: Integration | 3.5h | 1 day |
| **Total** | **11.5h** | **3 days** |

---

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| OpenAI embedding API rate limits | Med | Low | Batch requests, cache aggressively |
| Embedding costs scale unexpectedly | Low | Low | Monitor usage, switch to local model if needed |
| Session transcript format changes | Med | Med | Abstract transcript parsing layer |
| Search quality disappoints | High | Med | Tune similarity threshold, add reranking |
| SQLite performance at scale (>50k) | Med | Low | Migrate to sqlite-vec if needed |

---

## Out of Scope

- Multi-modal embeddings (images, audio)
- Real-time streaming extraction
- Cross-user memory sharing
- Memory summarization/compression
- Knowledge graph construction

---

## Open Questions

1. **Trigger mechanism:** How to hook into session completion? Heartbeat? Explicit call?
2. **Transcript access:** Where are session transcripts stored? Format?
3. **Embedding model:** Lock to OpenAI or build provider abstraction?
4. **Similarity threshold:** What cutoff for "relevant"? (Suggest: 0.7)

---

## Success Metrics

- 80%+ of "what did we discuss" queries return relevant results
- <5 irrelevant memories extracted per 100 sessions
- Zero increase in main agent response latency
- <$1/month embedding costs at typical usage
