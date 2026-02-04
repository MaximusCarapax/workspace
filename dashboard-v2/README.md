# Mission Control Dashboard v2

A modern rebuild of the Mission Control dashboard using React + Tailwind CSS.

## Features

✅ **Overview Tab**
- System health status with colored indicators
- Today's cost tracking with model breakdown  
- Current task display
- Recently completed tasks list

✅ **Journals Tab**  
- Sidebar list of daily journal entries
- Markdown rendering of journal content
- Responsive layout

✅ **Tasks Tab**
- Enhanced current task view
- Recently completed tasks with visual indicators

✅ **Activity Tab**
- Recent activity feed
- Real-time updates

## Architecture

### Backend (`backend.cjs`)
- Express server on port 3003
- Reuses existing `../lib/db` for data access
- API endpoints:
  - `/api/health` - System health status
  - `/api/costs` - Cost tracking data  
  - `/api/tasks` - Task management
  - `/api/journals` - Daily journal entries
  - `/api/activity` - Activity feed

### Frontend (`index.html`)
- Single-page React app
- Tailwind CSS for styling
- CDN-based dependencies (React, Babel, Marked)
- Custom dark theme matching original aesthetic

## Usage

```bash
# Start backend server
cd dashboard-v2
node backend.cjs

# Visit http://localhost:3003
```

## Technology Stack

- **React 18** - Component framework
- **Tailwind CSS** - Styling framework  
- **Express.js** - Backend API server
- **Marked.js** - Markdown parsing
- **SQLite** - Database (via existing lib/db)

## Design Principles

1. **Keep it simple** - Minimal dependencies, CDN-based
2. **Match original** - Same API endpoints and functionality
3. **Modern stack** - React + Tailwind as requested
4. **Dark theme** - Consistent with original aesthetic
5. **Responsive** - Mobile-friendly design

## Deployment

The app is production-ready and can be deployed by:
1. Running the backend server
2. Serving the static HTML file
3. Ensuring database access via `../lib/db`

Built in under $1 budget using DeepSeek for code generation assistance.