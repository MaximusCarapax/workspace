import Link from 'next/link';
import { getDocsByFolder, getAllTags } from '@/lib/brain';

export const dynamic = 'force-dynamic';

export default function Home() {
  const folders = getDocsByFolder();
  const tags = getAllTags();
  
  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">🧠 2nd Brain</div>
          <div className="sidebar-subtitle">Maximus Carapax</div>
        </div>
        
        <div className="search-container">
          <input
            type="text"
            placeholder="Search..."
            className="search-input"
          />
        </div>
        
        <nav className="sidebar-nav">
          {folders.map(folder => (
            <div key={folder.name} className="nav-section">
              <div className="nav-section-title">
                <span className="nav-section-icon">{folder.icon}</span>
                {folder.name === 'root' ? 'Home' : folder.name}
              </div>
              <ul className="nav-list">
                {folder.docs.map(doc => (
                  <li key={doc.slug}>
                    <Link href={`/doc/${doc.slug}`} className="nav-item">
                      {doc.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        
        <div className="sidebar-tags">
          <div className="tags-title">Tags</div>
          <div className="tags-container">
            {tags.slice(0, 10).map(({ tag, count }) => (
              <span key={tag} className="tag">
                {tag}<span className="tag-count">{count}</span>
              </span>
            ))}
          </div>
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        <div className="content-wrapper">
          <div className="home-hero">
            <h1 className="home-title">Welcome to the 2nd Brain</h1>
            <p className="home-subtitle">
              A living knowledge base that grows as we work together.
            </p>
          </div>
          
          {/* Recent Journals */}
          <section className="home-section">
            <h2 className="section-title cyan">📅 Recent Journals</h2>
            <div className="card-grid">
              {folders.find(f => f.name === 'journals')?.docs.slice(0, 5).map(doc => (
                <Link key={doc.slug} href={`/doc/${doc.slug}`} className="card">
                  <h3 className="card-title">{doc.title}</h3>
                  <div className="card-tags">
                    {doc.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </section>
          
          {/* Concepts */}
          <section className="home-section">
            <h2 className="section-title accent">💡 Concepts</h2>
            <div className="card-grid">
              {folders.find(f => f.name === 'concepts')?.docs.map(doc => (
                <Link key={doc.slug} href={`/doc/${doc.slug}`} className="card">
                  <h3 className="card-title">{doc.title}</h3>
                  <div className="card-tags">
                    {doc.tags.map(tag => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
