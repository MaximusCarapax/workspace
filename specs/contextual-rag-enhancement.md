# Contextual RAG Enhancement

**Feature:** #1259  
**Status:** Spec  
**Author:** Maximus Carapax  
**Date:** 2026-02-05

## Problem

Current session memory RAG uses naive chunking — chunks are embedded without context about WHERE they came from or WHAT they're about. This leads to:
- Retrieving chunks that match keywords but miss semantic intent
- Losing important context (who said what, when, about what topic)
- ~49% higher retrieval failure rate vs contextual approach (per Anthropic research)

## Solution: Anthropic's Contextual Retrieval

### 1. Context Prepending (Primary Enhancement)

Before embedding each chunk, use an LLM to generate a short context prefix:

```
Original chunk:
"Yes please"
"Done. I'm your Chief of Staff now — officially."

Contextualized chunk:
"[Context: Conversation between Jason and Max on 2026-02-05 about role promotion. Max updated SOUL.md to reflect Chief of Staff title.]
Yes please
Done. I'm your Chief of Staff now — officially."
```

**Implementation:**
- During chunking, call Gemini (via OpenRouter) to generate ~50 token context
- Prepend context to chunk content
- Embed the contextualized content
- Store both original and contextualized versions

**Prompt template:**
```
Given this chunk from a conversation transcript, write a brief context (1-2 sentences) that explains:
- Who is speaking (if identifiable)
- What topic/decision this relates to
- When this occurred (if timestamp available)

Chunk:
{chunk_content}

Context:
```

### 2. Hybrid Search (Secondary Enhancement)

Combine embedding similarity with BM25 keyword matching:

```
Final Score = (0.7 × embedding_similarity) + (0.3 × bm25_score)
```

**Implementation:**
- Add BM25 index on chunk content
- On search: run both embedding search and BM25
- Combine scores with weighting
- Return merged, deduplicated results

### 3. Enhanced Metadata

Store richer metadata per chunk:
- `speakers`: Who spoke in this chunk (Jason, Max, System)
- `topic_summary`: LLM-generated topic (replaces keyword extraction)
- `has_decision`: Boolean flag for chunks containing decisions
- `has_action_item`: Boolean flag for action items
- `sentiment`: Optional sentiment indicator

## Schema Changes

```sql
ALTER TABLE session_chunks ADD COLUMN context_prefix TEXT;
ALTER TABLE session_chunks ADD COLUMN topic_summary TEXT;
ALTER TABLE session_chunks ADD COLUMN context_status TEXT DEFAULT 'pending'; -- pending, complete, failed
-- speakers, has_decision, has_action already exist
```

## Backfill Strategy

**Approach:** Optional background backfill via script.

- Existing ~2000 chunks will be backfilled with context
- One-time cost: ~$0.08 (negligible)
- Script: `node tools/session-memory.js backfill-context --batch 100`
- Processes in batches of 100, can be interrupted and resumed
- Re-generates embeddings for backfilled chunks
- Estimated runtime: ~10-15 minutes for 2000 chunks

**Why backfill:** Consistent search quality across all memories, not just new ones.

## Error Handling

**Context generation failures:**
1. If Gemini API fails for a chunk → save chunk without context
2. Set `context_status = 'failed'` for retry later
3. Don't fail the entire batch
4. Background job can retry failed chunks

**Graceful degradation:** System works with or without context — context just improves quality.

## Score Fusion: Reciprocal Rank Fusion (RRF)

Instead of weighted sum (scales don't match), use RRF:

```
RRF_score(chunk) = Σ 1 / (k + rank_in_result_set)
```

Where `k = 60` (standard constant).

**Process:**
1. Run embedding search → get ranked results
2. Run BM25 search → get ranked results  
3. For each chunk, compute RRF score from both rankings
4. Sort by combined RRF score
5. Return top N

This handles different scales naturally and is industry standard.

## Success Metrics

**Concrete test cases:**
1. Search "the promotion" → returns Chief of Staff conversation (Feb 5)
2. Search "my phone number" → returns +61 468 089 420 setup conversation
3. Search "cost concerns" → returns budget/API cost discussions
4. Search "forgot something" → returns compaction recovery conversations

**Quantitative:** Compare retrieval accuracy on 10 test queries before/after.

## Cost Analysis

**Context generation (Gemini via OpenRouter):**
- Input: ~200 tokens/chunk (chunk content)
- Output: ~50 tokens/chunk (context)
- Cost: ~$0.10/M input, $0.40/M output
- Per 1000 chunks: ~$0.04

**Incremental cost (15-min crons):**
- ~5-10 new chunks per run
- Cost per run: ~$0.0004
- Daily cost: ~$0.02

**Verdict:** Negligible cost for significant retrieval improvement.

## Implementation Plan

### Story 1: Context Generation Pipeline
- Add `generateContext()` function using Gemini via OpenRouter
- Integrate into chunking pipeline
- Store context_prefix in database
- Update embedding to use contextualized content

### Story 2: Hybrid Search with BM25
- Add BM25 index (use sqlite FTS5)
- Modify search to run both methods
- Implement score combination
- Tune weighting based on results

### Story 3: Enhanced Topic Extraction
- Replace keyword extraction with LLM summarization
- Generate topic_summary during chunking
- Update search to filter by topic

## Acceptance Criteria

- [ ] New chunks get LLM-generated context prepended
- [ ] Context stored in `context_prefix` column
- [ ] Embeddings use contextualized content
- [ ] Search combines embedding + BM25 scores
- [ ] Search quality improves (manual testing)
- [ ] Cost per chunk < $0.001
- [ ] Backward compatible (existing chunks still searchable)

## Testing

1. Chunk a known conversation
2. Search for implicit references (e.g., "the promotion" without saying "Chief of Staff")
3. Compare results with/without contextual retrieval
4. Measure retrieval accuracy improvement

## References

- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [Together AI Implementation Guide](https://docs.together.ai/docs/how-to-implement-contextual-rag-from-anthropic)
