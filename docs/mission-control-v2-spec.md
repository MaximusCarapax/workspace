# Mission Control v2 - Technical Specification

*Overnight build: 2026-02-01*

## Overview

Transform the static dashboard into a real-time, two-way Mission Control accessible from Jason's laptop.

## Current State
- `dashboard/index.html` - Static HTML, reads from `data.json`
- `dashboard/data.json` - Manual/script-updated JSON
- No backend, no API, no interactivity

## Target State
- Express.js server serving dashboard + REST API
- Real-time status indicator showing Maximus activity
- Kanban board synced with Linear
- Two-way: Jason can add tasks, mark habits, drop notes
- Accessible via browser from any device on network

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Mission Control                       │
├─────────────────────────────────────────────────────────┤
│  Frontend (HTML/CSS/JS)                                 │
│  - Status indicator (last active)                       │
│  - Kanban board (from Linear)                           │
│  - Habits tracker (interactive)                         │
│  - Brain dump (add notes)                               │
│  - Activity log                                         │
├─────────────────────────────────────────────────────────┤
│  Express Backend (Node.js)                              │
│  - GET/POST /api/status                                 │
│  - GET/POST /api/habits                                 │
│  - GET/POST /api/notes                                  │
│  - GET /api/tasks (Linear sync)                         │
│  - GET /api/activity                                    │
├─────────────────────────────────────────────────────────┤
│  Data Layer                                             │
│  - status.json (last active, current task)              │
│  - habits.json (habit definitions + history)            │
│  - notes.json (brain dump entries)                      │
│  - activity.json (activity log)                         │
│  - Linear API for tasks (read-only sync)                │
└─────────────────────────────────────────────────────────┘
```

---

## Features

### 1. Status Indicator
**Purpose:** Show if Maximus is active/idle

**Data model:**
```json
{
  "lastActive": "2026-02-01T12:30:00Z",
  "lastActiveDesc": "Replied to Jason on Telegram",
  "status": "idle"  // idle | working | thinking
}
```

**Display:**
- Green dot + "Active now" if lastActive < 5 min ago
- Yellow dot + "Last seen X min ago" if < 1 hour
- Gray dot + "Last seen at HH:MM" if > 1 hour

**Update mechanism:**
- Maximus calls `POST /api/status` or writes to `status.json` when active
- Frontend polls every 30s

### 2. Kanban Board (Linear Sync)
**Purpose:** View tasks from Linear in kanban format

**Columns:**
- Backlog
- To Do
- In Progress
- Done

**Data source:** Linear API via `node tools/linear.js`

**Sync:** Every 5 minutes or on manual refresh

**Read-only v1:** No task creation from dashboard (use Linear or tell Maximus)

### 3. Habits Tracker (Interactive)
**Purpose:** Mark habit steps as done

**Existing habits:**
- Morning Mouth Protocol (5 steps)
- Daily Movement (1 step)

**Interactivity:**
- Click step to toggle done/not done
- Visual streak tracking
- Week view with completion status

**API:**
- `GET /api/habits` - Get habits + history
- `POST /api/habits/:habitId/steps/:stepId` - Toggle step for today

### 4. Brain Dump (Two-way)
**Purpose:** Jason drops notes, Maximus processes them

**Features:**
- Text input field to add new notes
- List of recent notes
- "Processed" indicator when Maximus has seen it

**API:**
- `GET /api/notes` - Get all notes
- `POST /api/notes` - Add new note
- `PATCH /api/notes/:id` - Mark as processed

### 5. Activity Log
**Purpose:** Show what Maximus has been doing

**Data:** Append-only log of activities

**API:**
- `GET /api/activity` - Get recent activity (last 50)
- `POST /api/activity` - Add activity entry (internal use)

---

## File Structure

```
dashboard/
├── server.js           # Express server
├── public/
│   ├── index.html      # Main dashboard
│   ├── styles.css      # Extracted styles
│   └── app.js          # Frontend JS
├── data/
│   ├── status.json
│   ├── habits.json
│   ├── notes.json
│   └── activity.json
├── lib/
│   └── linear.js       # Linear sync helper
└── package.json
```

---

## API Endpoints

### Status
```
GET /api/status
Response: { lastActive, lastActiveDesc, status }

POST /api/status
Body: { status?, desc? }
Updates lastActive timestamp
```

### Habits
```
GET /api/habits
Response: { habits: {...}, today: "2026-02-01" }

POST /api/habits/:habitId/toggle/:stepId
Toggles step completion for today
Response: { success, habit }
```

### Notes
```
GET /api/notes
Response: { notes: [...] }

POST /api/notes
Body: { text }
Response: { success, note }

PATCH /api/notes/:id
Body: { processed: true }
Response: { success }
```

### Tasks (Linear)
```
GET /api/tasks
Response: { tasks: [...], columns: {...} }
Synced from Linear, grouped by state
```

### Activity
```
GET /api/activity?limit=50
Response: { activities: [...] }

POST /api/activity
Body: { content }
Response: { success }
```

---

## Frontend Components

### Header
- Logo/title
- Status indicator (dot + text)
- Last updated timestamp

### Main Grid
1. **Status Card** - Current status, last active
2. **Kanban Board** - Full width, scrollable columns
3. **Habits Card** - Interactive checkboxes, week view
4. **Notes Card** - Input field + list
5. **Activity Card** - Timeline view
6. **Infrastructure Card** - Static status list

---

## Implementation Plan

### Phase 1: Backend Setup
1. Create `server.js` with Express
2. Set up static file serving
3. Implement data file read/write helpers
4. Create API routes

### Phase 2: Data Migration
1. Move existing `data.json` to separate files
2. Add `status.json` with initial data
3. Migrate habits/notes structure

### Phase 3: Frontend Refactor
1. Extract CSS to `styles.css`
2. Extract JS to `app.js`
3. Update to use new API endpoints
4. Add status indicator component
5. Add kanban board component
6. Make habits interactive
7. Add notes input

### Phase 4: Linear Integration
1. Create `lib/linear.js` helper
2. Implement task fetch + state grouping
3. Add sync endpoint
4. Render kanban in frontend

### Phase 5: Polish
1. Error handling
2. Loading states
3. Mobile responsive
4. Auto-refresh

---

## Deployment

For now: Run locally alongside gateway

```bash
cd dashboard
npm install
node server.js
# Runs on port 3001
```

Zeabur can expose the port or we proxy through gateway later.

---

## Future Enhancements (v3+)
- WebSocket for real-time updates
- Task creation from dashboard
- Calendar integration
- Habit reminders
- Mobile app via PWA
