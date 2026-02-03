#!/usr/bin/env node
/**
 * Linear CLI - Task management via Linear GraphQL API
 * 
 * Usage:
 *   node linear.js list                          # List issues
 *   node linear.js create "Title" -d desc -p 2   # Create issue
 *   node linear.js view <id>                     # View issue details
 *   node linear.js update <id> --state "Done"    # Update state
 *   node linear.js comment <id> "text"           # Add comment
 *   node linear.js search "query"                # Search issues
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const CREDENTIALS_PATH = path.join(os.homedir(), '.openclaw', 'secrets', 'credentials.json');

let apiKey = null;
let currentUserId = null;
let defaultTeamId = null;
let teamStateMappings = {};

async function readApiKey() {
  try {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    if (!credentials.linear?.apiKey) {
      throw new Error('Linear API key not found in credentials.json');
    }
    apiKey = credentials.linear.apiKey;
    return apiKey;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Credentials file not found at ${CREDENTIALS_PATH}`);
    }
    throw error;
  }
}

async function graphqlRequest(query, variables = {}) {
  if (!apiKey) throw new Error('API key not initialized');

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join(', '));
  }
  return json.data;
}

async function init() {
  await readApiKey();

  const viewerData = await graphqlRequest(`query { viewer { id email } }`);
  currentUserId = viewerData.viewer.id;
  console.error(`Linear: ${viewerData.viewer.email}`);

  const teamsData = await graphqlRequest(`
    query { teams { nodes { id name states { nodes { id name } } } } }
  `);
  
  if (!teamsData.teams?.nodes?.length) {
    throw new Error('No teams found');
  }

  defaultTeamId = teamsData.teams.nodes[0].id;
  console.error(`Team: ${teamsData.teams.nodes[0].name}`);

  teamsData.teams.nodes.forEach(team => {
    teamStateMappings[team.id] = {};
    team.states.nodes.forEach(state => {
      teamStateMappings[team.id][state.name.toLowerCase()] = state.id;
    });
  });
}

async function listIssues() {
  const data = await graphqlRequest(`
    query($userId: ID!) {
      issues(
        filter: { or: [{ assignee: { id: { eq: $userId } } }, { assignee: { null: true } }] }
        first: 20
        orderBy: updatedAt
      ) {
        nodes { identifier id title state { name } priority assignee { name } }
      }
    }
  `, { userId: currentUserId });

  if (!data.issues.nodes.length) {
    console.log('No issues found');
    return;
  }

  console.log('\nIssues:');
  data.issues.nodes.forEach(issue => {
    const priority = ['', '🔴', '🟠', '🟡', '⚪'][issue.priority] || '';
    const assignee = issue.assignee?.name || 'Unassigned';
    console.log(`  ${issue.identifier} ${priority} [${issue.state.name}] ${issue.title} (${assignee})`);
  });
}

async function createIssue(title, description, priority) {
  if (!title) throw new Error('Title required');
  if (priority && (priority < 1 || priority > 4)) throw new Error('Priority must be 1-4');

  const data = await graphqlRequest(`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { identifier id title state { name } }
      }
    }
  `, {
    input: {
      title,
      teamId: defaultTeamId,
      ...(description && { description }),
      ...(priority && { priority }),
    },
  });

  console.log(`✅ Created: ${data.issueCreate.issue.identifier} - ${data.issueCreate.issue.title}`);
}

async function viewIssue(issueId) {
  const data = await graphqlRequest(`
    query($id: String!) {
      issue(id: $id) {
        identifier id title description state { name } priority
        creator { name } assignee { name }
        comments { nodes { body createdAt creator { name } } }
      }
    }
  `, { id: issueId });

  if (!data.issue) {
    console.log(`Issue "${issueId}" not found`);
    return;
  }

  const i = data.issue;
  console.log(`\n${i.identifier}: ${i.title}`);
  console.log(`State: ${i.state.name} | Priority: ${i.priority || 'None'}`);
  console.log(`Assignee: ${i.assignee?.name || 'Unassigned'}`);
  if (i.description) console.log(`\nDescription:\n${i.description}`);
  
  if (i.comments.nodes.length) {
    console.log('\nComments:');
    i.comments.nodes.forEach(c => {
      console.log(`  ${c.creator.name} (${new Date(c.createdAt).toLocaleDateString()}): ${c.body}`);
    });
  }
}

async function updateIssue(issueId, stateName) {
  const stateId = teamStateMappings[defaultTeamId]?.[stateName.toLowerCase()];
  if (!stateId) {
    const available = Object.keys(teamStateMappings[defaultTeamId] || {}).join(', ');
    throw new Error(`State "${stateName}" not found. Available: ${available}`);
  }

  const data = await graphqlRequest(`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        issue { identifier title state { name } }
      }
    }
  `, { id: issueId, input: { stateId } });

  console.log(`✅ ${data.issueUpdate.issue.identifier} → ${data.issueUpdate.issue.state.name}`);
}

async function addComment(issueId, text) {
  if (!text) throw new Error('Comment text required');

  const data = await graphqlRequest(`
    mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        comment { issue { identifier title } }
      }
    }
  `, { input: { issueId, body: text } });

  console.log(`✅ Comment added to ${data.commentCreate.comment.issue.identifier}`);
}

async function searchIssues(queryText) {
  const data = await graphqlRequest(`
    query($q: String!) {
      issues(
        filter: { or: [{ title: { containsIgnoreCase: $q } }, { description: { containsIgnoreCase: $q } }] }
        first: 20
      ) {
        nodes { identifier title state { name } assignee { name } }
      }
    }
  `, { q: queryText });

  if (!data.issues.nodes.length) {
    console.log(`No issues found for "${queryText}"`);
    return;
  }

  console.log(`\nResults for "${queryText}":`);
  data.issues.nodes.forEach(i => {
    console.log(`  ${i.identifier} [${i.state.name}] ${i.title}`);
  });
}

function displayHelp() {
  console.log(`
Linear CLI - Task management

Commands:
  list                              List my issues
  create <title> [-d desc] [-p 1-4] Create issue
  view <id>                         View issue details  
  update <id> --state <name>        Update issue state
  comment <id> <text>               Add comment
  search <query>                    Search issues

Examples:
  node linear.js list
  node linear.js create "Fix bug" -d "Details" -p 1
  node linear.js view MAX-5
  node linear.js update MAX-5 --state "Done"
  node linear.js comment MAX-5 "Fixed in commit abc123"
  node linear.js search "login"
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help') {
    displayHelp();
    return;
  }

  try {
    await init();

    switch (command) {
      case 'list':
        await listIssues();
        break;

      case 'create': {
        let title = '', description = '', priority = null;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '-d') description = args[++i];
          else if (args[i] === '-p') priority = parseInt(args[++i], 10);
          else if (!title) title = args[i];
          else title += ' ' + args[i];
        }
        await createIssue(title, description, priority);
        break;
      }

      case 'view':
        if (!args[1]) throw new Error('Issue ID required');
        await viewIssue(args[1]);
        break;

      case 'update': {
        const stateIdx = args.indexOf('--state');
        if (!args[1] || stateIdx === -1 || !args[stateIdx + 1]) {
          throw new Error('Usage: update <id> --state <name>');
        }
        await updateIssue(args[1], args[stateIdx + 1]);
        break;
      }

      case 'comment':
        if (!args[1] || !args[2]) throw new Error('Usage: comment <id> <text>');
        await addComment(args[1], args.slice(2).join(' '));
        break;

      case 'search':
        if (!args[1]) throw new Error('Search query required');
        await searchIssues(args.slice(1).join(' '));
        break;

      default:
        console.log(`Unknown command: ${command}`);
        displayHelp();
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
