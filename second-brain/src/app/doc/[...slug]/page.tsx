import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDocBySlug, renderMarkdown, getDocsByFolder, getAllDocs } from '@/lib/brain';

export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string[] };
}

export default async function DocPage({ params }: Props) {
  const slug = params.slug.join('/');
  const doc = getDocBySlug(slug);
  
  if (!doc) {
    notFound();
  }
  
  const htmlContent = await renderMarkdown(doc.content);
  const folders = getDocsByFolder();
  
  // Find backlinks (docs that link to this one)
  const allDocs = getAllDocs();
  const backlinks = allDocs.filter(d => 
    d.content.includes(`[[${slug}]]`) || 
    d.content.includes(`[[${doc.title}]]`) ||
    d.related?.includes(`[[${slug}]]`)
  );
  
  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Link href="/">
            <div className="sidebar-logo">🧠 2nd Brain</div>
          </Link>
          <div className="sidebar-subtitle">Maximus Carapax</div>
        </div>
        
        <nav className="sidebar-nav">
          {folders.map(folder => (
            <div key={folder.name} className="nav-section">
              <div className="nav-section-title">
                <span className="nav-section-icon">{folder.icon}</span>
                {folder.name === 'root' ? 'Home' : folder.name}
              </div>
              <ul className="nav-list">
                {folder.docs.map(d => (
                  <li key={d.slug}>
                    <Link 
                      href={`/doc/${d.slug}`}
                      className={`nav-item ${d.slug === slug ? 'active' : ''}`}
                    >
                      {d.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        <article className="content-wrapper">
          {/* Header */}
          <header className="doc-header">
            <div className="doc-breadcrumb">
              <Link href="/">Home</Link>
              <span>/</span>
              <span style={{textTransform: 'capitalize'}}>{doc.folder}</span>
            </div>
            
            <h1 className="doc-title">{doc.title}</h1>
            
            <div className="doc-meta">
              {(doc.date || doc.created) && (
                <span className="doc-date">📅 {doc.date || doc.created}</span>
              )}
              {doc.tags.length > 0 && (
                <div className="card-tags">
                  {doc.tags.map(tag => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </header>
          
          {/* Content */}
          <div 
            className="prose"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
          
          {/* Backlinks */}
          {backlinks.length > 0 && (
            <footer className="backlinks-section">
              <h2 className="backlinks-title">
                🔗 Linked Mentions ({backlinks.length})
              </h2>
              <div className="backlinks-grid">
                {backlinks.map(bl => (
                  <Link key={bl.slug} href={`/doc/${bl.slug}`} className="backlink-card">
                    <span className="backlink-card-title">{bl.title}</span>
                    <span className="backlink-card-folder">({bl.folder})</span>
                  </Link>
                ))}
              </div>
            </footer>
          )}
        </article>
      </main>
    </div>
  );
}
