// All styles as a string - workaround for broken CSS loader
export const globalStyles = `
/* ========================================
   2nd Brain - Custom CSS
   Obsidian + Linear inspired dark theme
   ======================================== */

:root {
  --bg-primary: #0f0f17;
  --bg-secondary: #1a1a2e;
  --bg-tertiary: #252542;
  --border: #2a2a4a;
  --border-hover: #3a3a5a;
  --accent: #7c3aed;
  --accent-hover: #9055ff;
  --cyan: #00d4ff;
  --text-primary: #e4e4e4;
  --text-secondary: #a0a0b0;
  --text-muted: #666680;
  --success: #10b981;
  --warning: #f59e0b;
  --radius: 8px;
  --radius-lg: 12px;
}

*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  height: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--cyan);
  text-decoration: none;
  transition: color 0.2s;
}

a:hover {
  color: var(--accent);
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
}

.app-container {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 280px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  overflow: hidden;
}

.sidebar-header {
  padding: 24px 20px;
  border-bottom: 1px solid var(--border);
}

.sidebar-logo {
  font-size: 1.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--cyan), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-subtitle {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.search-container {
  padding: 16px 20px;
}

.search-input {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  border-color: var(--accent);
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}

.nav-section {
  margin-bottom: 20px;
}

.nav-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-section-icon {
  font-size: 1rem;
}

.nav-list {
  list-style: none;
}

.nav-item {
  display: block;
  padding: 8px 12px;
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 0.9rem;
  transition: all 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item:hover {
  background: rgba(124, 58, 237, 0.1);
  color: var(--text-primary);
}

.nav-item.active {
  background: rgba(124, 58, 237, 0.2);
  color: var(--accent);
}

.sidebar-tags {
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.tags-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.main-content {
  flex: 1;
  margin-left: 280px;
  padding: 48px;
  overflow-y: auto;
  min-height: 100vh;
}

.content-wrapper {
  max-width: 800px;
  margin: 0 auto;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent);
  transition: all 0.2s;
}

.tag:hover {
  background: rgba(124, 58, 237, 0.25);
  border-color: var(--accent);
}

.tag-count {
  margin-left: 6px;
  opacity: 0.6;
}

.card {
  display: block;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  transition: all 0.2s;
  text-decoration: none;
}

.card:hover {
  border-color: rgba(124, 58, 237, 0.5);
  transform: translateY(-2px);
}

.card-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card-grid {
  display: grid;
  gap: 16px;
}

.home-hero {
  text-align: center;
  padding: 48px 0 64px;
}

.home-title {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, var(--cyan), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 16px;
}

.home-subtitle {
  font-size: 1.1rem;
  color: var(--text-muted);
}

.home-section {
  margin-bottom: 48px;
}

.section-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title.cyan {
  color: var(--cyan);
}

.section-title.accent {
  color: var(--accent);
}

.doc-header {
  margin-bottom: 32px;
}

.doc-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.doc-breadcrumb a {
  color: var(--text-muted);
}

.doc-breadcrumb a:hover {
  color: var(--cyan);
}

.doc-title {
  font-size: 2.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 16px;
  line-height: 1.3;
}

.doc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.doc-date {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prose {
  color: var(--text-primary);
  line-height: 1.8;
}

.prose h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--cyan);
  margin: 48px 0 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.prose h1:first-child {
  margin-top: 0;
}

.prose h2 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--accent);
  margin: 40px 0 20px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.prose h3 {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 32px 0 16px;
}

.prose p {
  margin: 16px 0;
}

.prose ul, .prose ol {
  margin: 16px 0;
  padding-left: 24px;
}

.prose li {
  margin: 8px 0;
}

.prose strong {
  color: var(--text-primary);
  font-weight: 600;
}

.prose code {
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.9em;
  color: var(--warning);
}

.prose pre {
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  overflow-x: auto;
  margin: 24px 0;
}

.prose pre code {
  background: none;
  padding: 0;
  color: var(--text-primary);
  font-size: 0.85rem;
}

.prose blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 20px;
  margin: 24px 0;
  color: var(--text-secondary);
  font-style: italic;
}

.prose a {
  color: var(--cyan);
}

.backlink {
  color: var(--cyan);
  background: rgba(0, 212, 255, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

.backlink:hover {
  background: rgba(0, 212, 255, 0.2);
}

.backlinks-section {
  margin-top: 64px;
  padding-top: 32px;
  border-top: 1px solid var(--border);
}

.backlinks-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.backlinks-grid {
  display: grid;
  gap: 12px;
}

.backlink-card {
  display: block;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: all 0.2s;
}

.backlink-card:hover {
  border-color: rgba(124, 58, 237, 0.5);
  background: var(--bg-tertiary);
}

.backlink-card-title {
  font-weight: 500;
  color: var(--text-primary);
}

.backlink-card-folder {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-left: 8px;
}

@media (max-width: 768px) {
  .sidebar {
    position: relative;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  
  .main-content {
    margin-left: 0;
    padding: 24px;
  }
  
  .app-container {
    flex-direction: column;
  }
  
  .home-title {
    font-size: 2rem;
  }
  
  .doc-title {
    font-size: 1.75rem;
  }
}
`;
