/**
 * Pipeline Sub-Agent Integration
 * 
 * Spawns specialized agents for different pipeline stages.
 * Uses sessions_spawn for isolated execution.
 */

const db = require('./db');

// Agent role configurations
const AGENT_ROLES = {
  spec: {
    name: 'Spec Agent',
    model: 'anthropic/claude-sonnet-4',
    emoji: '📋',
    timeout: 300, // 5 minutes
    getPrompt: (pipeline) => `You are a **Spec Agent** writing a technical specification.

## Your Task
Write a detailed spec for: **${pipeline.title}**

${pipeline.description ? `Description: ${pipeline.description}` : ''}

## Output Format
Produce a markdown spec with these sections:

### Goal
What are we building and why?

### Requirements
- Bullet list of functional requirements
- Be specific and testable

### Acceptance Criteria
- [ ] Checkbox list of "done when" criteria
- Each should be verifiable

### Technical Approach
How should this be built? Key decisions, patterns, tools.

### Tasks Breakdown
Numbered list of implementation tasks in order.

### Estimated Effort
How long will this take? (hours/days)

### Risks & Open Questions
Any unknowns or concerns?

---

## Guidelines
- Be concise but complete
- Focus on WHAT not HOW (implementation details come in build phase)
- Make acceptance criteria measurable
- Keep tasks atomic (1-4 hours each)

## Cost Efficiency
- Use tools/gemini.js for any research
- Use tools/deepseek.js for code examples
- Your role is to PLAN, not implement

Output ONLY the spec markdown. No preamble.`
  },

  build: {
    name: 'Build Agent',
    model: 'anthropic/claude-sonnet-4',
    emoji: '🔨',
    timeout: 600, // 10 minutes
    getPrompt: (pipeline, tasks) => `You are a **Build Agent** implementing a feature.

## Feature: ${pipeline.title}

## Spec
${pipeline.spec_doc || 'No spec provided - work from the title and description.'}

## Acceptance Criteria
${pipeline.acceptance_criteria || 'None specified'}

## Tasks to Complete
${tasks.length > 0 ? tasks.map((t, i) => `${i + 1}. [${t.status === 'done' ? 'x' : ' '}] ${t.title}`).join('\n') : 'No tasks defined - create them as you go.'}

---

## Your Job
1. Work through each task in order
2. Use \`aider --model deepseek/deepseek-chat\` for coding
3. Commit after each logical chunk
4. Report what you completed

## Guidelines
- Delegate ALL coding to DeepSeek via aider or tools/deepseek.js
- Your job is to orchestrate, not write code directly
- Test as you go
- If blocked, note it and move on

## Output Format
Report your progress:

### Completed
- Task 1: [status] - what was done
- Task 2: [status] - what was done

### Files Changed
- path/to/file.js - description

### Commits
- abc123 - commit message

### Blocked/Issues
- Any blockers or issues encountered

### Next Steps
- What remains to be done

Output ONLY the progress report. No preamble.`
  },

  review: {
    name: 'QA Agent',
    model: 'anthropic/claude-3-5-haiku-latest',
    emoji: '🔍',
    timeout: 180, // 3 minutes
    getPrompt: (pipeline) => `You are a **QA Agent** reviewing completed work.

## Feature: ${pipeline.title}

## Acceptance Criteria
${pipeline.acceptance_criteria || 'None specified - review against the spec.'}

## Spec
${pipeline.spec_doc || 'No spec available'}

---

## Your Job
1. Check each acceptance criterion
2. Run any tests if applicable
3. Note any issues found
4. Give a pass/fail verdict

## Output Format

### Acceptance Criteria Check
- [ ] Criterion 1: PASS/FAIL - notes
- [ ] Criterion 2: PASS/FAIL - notes

### Issues Found
- Issue 1: description
- Issue 2: description

### Test Results
(If you ran any tests)

### Verdict
**PASS** or **FAIL** with summary

### Recommendations
- Any improvements or follow-ups

Output ONLY the review report. No preamble.`
  }
};

/**
 * Generate a spawn request for the OpenClaw sessions_spawn tool
 */
function createSpawnRequest(role, pipeline) {
  const config = AGENT_ROLES[role];
  if (!config) throw new Error(`Unknown role: ${role}`);

  const tasks = role === 'build' ? db.getPipelineTasks(pipeline.id) : [];
  const prompt = config.getPrompt(pipeline, tasks);

  return {
    task: prompt,
    model: config.model,
    label: `pipeline-${role}-${pipeline.id}`,
    runTimeoutSeconds: config.timeout,
    cleanup: 'delete'
  };
}

/**
 * Save agent output back to the pipeline
 */
function saveAgentOutput(pipelineId, role, output) {
  const config = AGENT_ROLES[role];
  
  // Log as a note
  db.addPipelineNote({
    pipelineId,
    agentRole: role,
    noteType: 'output',
    content: output
  });

  // Update pipeline based on role
  if (role === 'spec') {
    // Parse spec and acceptance criteria
    const acMatch = output.match(/### Acceptance Criteria\n([\s\S]*?)(?=\n###|$)/);
    const acceptanceCriteria = acMatch ? acMatch[1].trim() : null;
    
    db.updatePipeline(pipelineId, {
      spec_doc: output,
      acceptance_criteria: acceptanceCriteria,
      stage: 'spec'
    });
    
    // Try to extract tasks
    const tasksMatch = output.match(/### Tasks Breakdown\n([\s\S]*?)(?=\n###|$)/);
    if (tasksMatch) {
      const taskLines = tasksMatch[1].trim().split('\n')
        .filter(line => /^\d+\./.test(line.trim()));
      for (const line of taskLines) {
        const title = line.replace(/^\d+\.\s*/, '').trim();
        if (title) {
          db.addPipelineTask({ pipelineId, title });
        }
      }
    }
  } else if (role === 'review') {
    db.updatePipeline(pipelineId, {
      review_notes: output
    });
    
    // Check if passed
    if (output.toLowerCase().includes('**pass**')) {
      db.updatePipeline(pipelineId, { stage: 'done' });
    }
  }

  return { success: true, role, pipelineId };
}

/**
 * Get spawn command for CLI output
 */
function getSpawnCommand(role, pipeline) {
  const request = createSpawnRequest(role, pipeline);
  
  // Return the JSON that can be passed to sessions_spawn
  return {
    command: `Run this with sessions_spawn:`,
    request: request,
    callback: `After completion, run: node tools/pipeline.js save-output ${pipeline.id} ${role} "<output>"`
  };
}

module.exports = {
  AGENT_ROLES,
  createSpawnRequest,
  saveAgentOutput,
  getSpawnCommand
};
