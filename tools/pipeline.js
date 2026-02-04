#!/usr/bin/env node
/**
 * Dev Pipeline CLI
 * 
 * Manage features through dev stages with specialized sub-agents.
 * 
 * Usage:
 *   pipeline.js list                      List active pipeline items
 *   pipeline.js add "title" [--project X] Add new pipeline item
 *   pipeline.js view <id>                 View pipeline item details
 *   pipeline.js approve <id>              Approve spec (Jason only)
 *   pipeline.js stage <id> <stage>        Move to stage
 *   pipeline.js spec <id>                 Run Spec Agent
 *   pipeline.js build <id>                Run Dev Agent
 *   pipeline.js review <id>               Run QA Agent
 */

const db = require('../lib/db');

const args = process.argv.slice(2);
const command = args[0];

const STAGES = ['idea', 'spec', 'ready', 'build', 'review', 'done'];
const STAGE_ICONS = {
  idea: '💡',
  spec: '📋',
  ready: '✅',
  build: '🔨',
  review: '🔍',
  done: '🚀'
};

const PRIORITY_ICONS = ['', '🔴', '🟠', '🟡', '🟢'];

function formatPipeline(p) {
  const stage = STAGE_ICONS[p.stage] || '❓';
  const priority = PRIORITY_ICONS[p.priority] || '⬜';
  return `${stage} [${p.id}] ${priority} ${p.title}`;
}

function printPipelineDetails(p) {
  console.log(`\n${STAGE_ICONS[p.stage]} Pipeline #${p.id}: ${p.title}`);
  console.log('─'.repeat(50));
  console.log(`Stage:    ${p.stage}`);
  console.log(`Priority: ${PRIORITY_ICONS[p.priority]} (${p.priority})`);
  if (p.description) console.log(`Desc:     ${p.description}`);
  if (p.project_id) console.log(`Project:  ${p.project_id}`);
  if (p.approved_by) console.log(`Approved: ${p.approved_by} @ ${p.approved_at}`);
  if (p.assigned_agent) console.log(`Agent:    ${p.assigned_agent}`);
  console.log(`Created:  ${p.created_at}`);
  
  if (p.spec_doc) {
    console.log(`\n📋 Spec:\n${p.spec_doc.slice(0, 500)}${p.spec_doc.length > 500 ? '...' : ''}`);
  }
  
  if (p.acceptance_criteria) {
    console.log(`\n✅ Acceptance Criteria:\n${p.acceptance_criteria}`);
  }
  
  if (p.review_notes) {
    console.log(`\n🔍 Review Notes:\n${p.review_notes}`);
  }
  
  // Show tasks
  const tasks = db.getPipelineTasks(p.id);
  if (tasks.length > 0) {
    console.log(`\n📝 Tasks (${tasks.length}):`);
    for (const t of tasks) {
      const status = { todo: '⬜', doing: '🔄', done: '✅', blocked: '🚫' }[t.status] || '❓';
      console.log(`   ${status} ${t.title}`);
    }
  }
  
  // Show notes
  const notes = db.getPipelineNotes(p.id);
  if (notes.length > 0) {
    console.log(`\n💬 Notes (${notes.length}):`);
    for (const n of notes) {
      console.log(`   [${n.agent_role}/${n.note_type}] ${n.content.slice(0, 100)}${n.content.length > 100 ? '...' : ''}`);
    }
  }
}

switch (command) {
  case 'list': {
    const stage = args.find(a => STAGES.includes(a));
    const projectId = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
    
    const items = db.listPipeline({ stage, projectId });
    
    if (items.length === 0) {
      console.log('📋 No active pipeline items.');
    } else {
      console.log(`📋 Pipeline (${items.length} items):\n`);
      
      // Group by stage
      for (const s of STAGES.filter(s => s !== 'done')) {
        const stageItems = items.filter(i => i.stage === s);
        if (stageItems.length > 0) {
          console.log(`  ${STAGE_ICONS[s]} ${s.toUpperCase()}:`);
          for (const item of stageItems) {
            console.log(`     [${item.id}] ${PRIORITY_ICONS[item.priority]} ${item.title}`);
          }
          console.log('');
        }
      }
    }
    break;
  }
  
  case 'add': {
    // Filter out flags and their values
    const filteredArgs = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--project' || args[i] === '--priority') {
        i++; // Skip the value too
      } else if (!args[i].startsWith('--')) {
        filteredArgs.push(args[i]);
      }
    }
    const title = filteredArgs.join(' ');
    const projectIdx = args.indexOf('--project');
    const projectId = projectIdx > -1 ? parseInt(args[projectIdx + 1]) : null;
    const priorityIdx = args.indexOf('--priority');
    const priority = priorityIdx > -1 ? parseInt(args[priorityIdx + 1]) : 2;
    
    if (!title) {
      console.error('Usage: pipeline.js add "Title" [--project X] [--priority 1-4]');
      process.exit(1);
    }
    
    const id = db.createPipeline({ title, projectId, priority });
    console.log(`💡 Created pipeline item:`);
    console.log(`   [${id}] ${title}`);
    console.log(`\nNext: Write spec with 'pipeline.js spec ${id}'`);
    break;
  }
  
  case 'view': {
    const id = parseInt(args[1]);
    if (!id) {
      console.error('Usage: pipeline.js view <id>');
      process.exit(1);
    }
    
    const p = db.getPipeline(id);
    if (!p) {
      console.error(`Pipeline item #${id} not found.`);
      process.exit(1);
    }
    
    printPipelineDetails(p);
    break;
  }
  
  case 'approve': {
    const id = parseInt(args[1]);
    if (!id) {
      console.error('Usage: pipeline.js approve <id>');
      process.exit(1);
    }
    
    const p = db.getPipeline(id);
    if (!p) {
      console.error(`Pipeline item #${id} not found.`);
      process.exit(1);
    }
    
    if (p.stage !== 'spec') {
      console.error(`Can only approve items in 'spec' stage. Current: ${p.stage}`);
      process.exit(1);
    }
    
    db.approvePipeline(id, 'jason');
    console.log(`✅ Approved: ${p.title}`);
    console.log(`   Stage: spec → ready`);
    console.log(`\nNext: Build with 'pipeline.js build ${id}'`);
    break;
  }
  
  case 'stage': {
    const id = parseInt(args[1]);
    const newStage = args[2];
    
    if (!id || !newStage) {
      console.error('Usage: pipeline.js stage <id> <stage>');
      console.error(`Stages: ${STAGES.join(', ')}`);
      process.exit(1);
    }
    
    if (!STAGES.includes(newStage)) {
      console.error(`Invalid stage: ${newStage}`);
      console.error(`Valid stages: ${STAGES.join(', ')}`);
      process.exit(1);
    }
    
    const p = db.getPipeline(id);
    if (!p) {
      console.error(`Pipeline item #${id} not found.`);
      process.exit(1);
    }
    
    db.updatePipeline(id, { stage: newStage });
    console.log(`${STAGE_ICONS[newStage]} Moved to ${newStage}: ${p.title}`);
    break;
  }
  
  case 'note': {
    const id = parseInt(args[1]);
    const content = args.slice(2).join(' ');
    
    if (!id || !content) {
      console.error('Usage: pipeline.js note <id> "Note content"');
      process.exit(1);
    }
    
    db.addPipelineNote({ pipelineId: id, agentRole: 'human', noteType: 'info', content });
    console.log(`💬 Note added to pipeline #${id}`);
    break;
  }
  
  case 'task': {
    const subcmd = args[1];
    const pipelineId = parseInt(args[2]);
    
    if (subcmd === 'add') {
      const title = args.slice(3).join(' ');
      if (!pipelineId || !title) {
        console.error('Usage: pipeline.js task add <pipeline_id> "Task title"');
        process.exit(1);
      }
      const taskId = db.addPipelineTask({ pipelineId, title });
      console.log(`📝 Task added: [${taskId}] ${title}`);
    } else if (subcmd === 'done') {
      const taskId = parseInt(args[2]);
      if (!taskId) {
        console.error('Usage: pipeline.js task done <task_id>');
        process.exit(1);
      }
      db.updatePipelineTask(taskId, { status: 'done', completed_at: new Date().toISOString() });
      console.log(`✅ Task #${taskId} completed`);
    } else {
      console.error('Usage: pipeline.js task add|done ...');
    }
    break;
  }
  
  case 'spec':
  case 'build':
  case 'review': {
    const id = parseInt(args[1]);
    if (!id) {
      console.error(`Usage: pipeline.js ${command} <id>`);
      process.exit(1);
    }
    
    const p = db.getPipeline(id);
    if (!p) {
      console.error(`Pipeline item #${id} not found.`);
      process.exit(1);
    }
    
    const agents = require('../lib/pipeline-agents');
    const config = agents.AGENT_ROLES[command];
    const request = agents.createSpawnRequest(command, p);
    
    console.log(`${config.emoji} Spawning ${config.name} for: ${p.title}`);
    console.log(`   Model: ${config.model}`);
    console.log(`   Timeout: ${config.timeout}s`);
    console.log('');
    
    // Output JSON for sessions_spawn
    console.log('─'.repeat(50));
    console.log('Copy this to spawn the agent:\n');
    console.log(JSON.stringify(request, null, 2));
    console.log('');
    console.log('─'.repeat(50));
    console.log(`After agent completes, save output with:`);
    console.log(`  pipeline.js save-output ${id} ${command}`);
    break;
  }
  
  case 'save-output': {
    const id = parseInt(args[1]);
    const role = args[2];
    
    if (!id || !role) {
      console.error('Usage: pipeline.js save-output <id> <role>');
      console.error('  Then paste the agent output and press Ctrl+D');
      process.exit(1);
    }
    
    const agents = require('../lib/pipeline-agents');
    
    // Read from stdin
    let output = '';
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin });
    
    console.log('Paste agent output, then press Ctrl+D:\n');
    
    rl.on('line', (line) => { output += line + '\n'; });
    rl.on('close', () => {
      if (!output.trim()) {
        console.error('No output provided.');
        process.exit(1);
      }
      
      const result = agents.saveAgentOutput(id, role, output.trim());
      console.log(`\n✅ Saved ${role} output for pipeline #${id}`);
      
      const p = db.getPipeline(id);
      console.log(`   Stage: ${p.stage}`);
      
      if (role === 'spec') {
        const tasks = db.getPipelineTasks(id);
        if (tasks.length > 0) {
          console.log(`   Tasks created: ${tasks.length}`);
        }
        console.log(`\nNext: Get approval with 'pipeline.js approve ${id}'`);
      } else if (role === 'build') {
        console.log(`\nNext: Review with 'pipeline.js review ${id}'`);
      } else if (role === 'review') {
        if (p.stage === 'done') {
          console.log(`\n🎉 Feature complete!`);
        } else {
          console.log(`\nReview noted. Fix issues and re-review.`);
        }
      }
    });
    return; // Don't break - async
  }
  
  case 'prompt': {
    // Just show the prompt without spawn instructions
    const id = parseInt(args[1]);
    const role = args[2] || 'spec';
    
    if (!id) {
      console.error('Usage: pipeline.js prompt <id> [spec|build|review]');
      process.exit(1);
    }
    
    const p = db.getPipeline(id);
    if (!p) {
      console.error(`Pipeline item #${id} not found.`);
      process.exit(1);
    }
    
    const agents = require('../lib/pipeline-agents');
    const config = agents.AGENT_ROLES[role];
    if (!config) {
      console.error(`Unknown role: ${role}. Use: spec, build, review`);
      process.exit(1);
    }
    
    const tasks = role === 'build' ? db.getPipelineTasks(id) : [];
    console.log(config.getPrompt(p, tasks));
    break;
  }
  
  case 'help':
  case '--help':
  case '-h':
  default:
    console.log(`🔧 Dev Pipeline CLI

Usage:
  pipeline.js list [stage] [--project X]  List pipeline items
  pipeline.js add "title" [--project X]   Add new pipeline item
  pipeline.js view <id>                   View details
  pipeline.js approve <id>                Approve spec (moves to ready)
  pipeline.js stage <id> <stage>          Manual stage change
  pipeline.js note <id> "content"         Add a note
  pipeline.js task add <id> "title"       Add a task
  pipeline.js task done <task_id>         Complete a task

Sub-Agent Commands:
  pipeline.js spec <id>                   Generate Spec Agent spawn config
  pipeline.js build <id>                  Generate Build Agent spawn config
  pipeline.js review <id>                 Generate QA Agent spawn config
  pipeline.js prompt <id> [role]          Show raw prompt for a role
  pipeline.js save-output <id> <role>     Save agent output (pipe or stdin)

Stages: ${STAGES.join(' → ')}

Workflow:
  1. add "Feature"        → Creates in 'idea' stage
  2. spec <id>            → Spawn spec agent, writes spec
  3. save-output <id> spec → Save spec, extracts tasks
  4. approve <id>         → Human approves, moves to 'ready'
  5. build <id>           → Spawn build agent, implements
  6. save-output <id> build → Save progress
  7. review <id>          → Spawn QA agent, validates
  8. save-output <id> review → Pass = done, Fail = fix & retry

Examples:
  pipeline.js add "Build dashboard" --priority 1
  pipeline.js spec 1
  # Copy output, run sessions_spawn in main chat
  # Paste result back:
  pipeline.js save-output 1 spec
  pipeline.js approve 1
`);
    break;
}
