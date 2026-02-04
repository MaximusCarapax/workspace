#!/usr/bin/env node
/**
 * Task Tracking Helper
 * 
 * Quick task management for tracking work in progress.
 * 
 * Usage:
 *   node tools/task.js start "Build model router"  # Create + start task
 *   node tools/task.js done                        # Complete current task
 *   node tools/task.js done "optional notes"       # Complete with notes
 *   node tools/task.js current                     # Show current task
 *   node tools/task.js list                        # List recent tasks
 */

const db = require('../lib/db');

const args = process.argv.slice(2);
const command = args[0];

// Get current in-progress task
function getCurrentTask() {
  const tasks = db.getTasks({ status: 'in_progress', limit: 1 });
  return tasks[0] || null;
}

// Format task for display
function formatTask(task) {
  const priority = ['', '🔴', '🟠', '🟡', '🟢'][task.priority] || '⬜';
  const status = {
    'todo': '⬜',
    'in_progress': '🔄',
    'done': '✅',
    'blocked': '🚫'
  }[task.status] || '❓';
  return `${status} [${task.id}] ${priority} ${task.title}`;
}

switch (command) {
  case 'start': {
    const title = args.slice(1).join(' ');
    if (!title) {
      console.error('Usage: task.js start "Task description"');
      process.exit(1);
    }
    
    // Check if there's already a task in progress
    const current = getCurrentTask();
    if (current) {
      console.log(`⚠️  Already have task in progress:`);
      console.log(`   ${formatTask(current)}`);
      console.log(`\nComplete it first with: task.js done`);
      process.exit(1);
    }
    
    // Create and start task
    const taskId = db.addTask({ 
      title, 
      status: 'in_progress',
      priority: 2 
    });
    
    console.log(`🚀 Started task:`);
    console.log(`   🔄 [${taskId}] ${title}`);
    break;
  }
  
  case 'done': {
    const notes = args.slice(1).join(' ');
    const current = getCurrentTask();
    
    if (!current) {
      console.log('❌ No task in progress.');
      console.log('Start one with: task.js start "description"');
      process.exit(1);
    }
    
    // Complete the task
    db.completeTask(current.id);
    
    // Log activity
    db.logActivity({
      action: 'task_completed',
      category: 'work',
      description: current.title + (notes ? ` — ${notes}` : '')
    });
    
    console.log(`✅ Completed:`);
    console.log(`   ${current.title}`);
    if (notes) console.log(`   Notes: ${notes}`);
    break;
  }
  
  case 'current': {
    const current = getCurrentTask();
    if (!current) {
      console.log('💤 No task in progress.');
    } else {
      console.log(`🔄 Current task:`);
      console.log(`   ${formatTask(current)}`);
      if (current.created_at) {
        const started = new Date(current.created_at);
        const mins = Math.round((Date.now() - started.getTime()) / 60000);
        console.log(`   Started: ${mins} minutes ago`);
      }
    }
    break;
  }
  
  case 'list': {
    const limit = parseInt(args[1]) || 10;
    
    // Show in-progress first
    const inProgress = db.getTasks({ status: 'in_progress', limit: 5 });
    // Then todo
    const todo = db.getTasks({ status: 'todo', limit });
    // Then recent done (need raw query)
    const done = db.db.prepare(`
      SELECT * FROM tasks WHERE status = 'done' 
      ORDER BY updated_at DESC LIMIT 5
    `).all();
    
    console.log(`📋 Tasks:\n`);
    
    if (inProgress.length > 0) {
      console.log('  In Progress:');
      for (const task of inProgress) {
        console.log(`   ${formatTask(task)}`);
      }
      console.log('');
    }
    
    if (todo.length > 0) {
      console.log('  Todo:');
      for (const task of todo.slice(0, 5)) {
        console.log(`   ${formatTask(task)}`);
      }
      if (todo.length > 5) console.log(`   ... and ${todo.length - 5} more`);
      console.log('');
    }
    
    if (done.length > 0) {
      console.log('  Recently Done:');
      for (const task of done) {
        console.log(`   ${formatTask(task)}`);
      }
    }
    break;
  }
  
  case 'cancel': {
    const current = getCurrentTask();
    if (!current) {
      console.log('❌ No task in progress to cancel.');
      process.exit(1);
    }
    
    db.updateTask(current.id, { status: 'todo' });
    console.log(`⏸️  Paused task (moved back to todo):`);
    console.log(`   ${current.title}`);
    break;
  }
  
  case 'help':
  case '--help':
  case '-h':
  default:
    console.log(`📋 Task Tracking Helper

Usage:
  task.js start "description"   Start working on a task
  task.js done [notes]          Complete current task
  task.js current               Show current task
  task.js list [n]              List recent tasks
  task.js cancel                Pause current task (back to todo)

Examples:
  task.js start "Build model router"
  task.js done "Added CLI and tests"
  task.js current
`);
    break;
}
