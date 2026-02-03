import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';

const BRAIN_DIR = path.join(process.cwd(), '..', 'brain');

export interface BrainDoc {
  slug: string;
  path: string;
  folder: string;
  title: string;
  tags: string[];
  date?: string;
  created?: string;
  related?: string[];
  content: string;
  htmlContent?: string;
}

export interface BrainFolder {
  name: string;
  icon: string;
  docs: BrainDoc[];
}

function getFilesRecursively(dir: string, basePath = ''): string[] {
  const files: string[] = [];
  
  if (!fs.existsSync(dir)) return files;
  
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const relativePath = path.join(basePath, item);
    
    if (fs.statSync(fullPath).isDirectory()) {
      files.push(...getFilesRecursively(fullPath, relativePath));
    } else if (item.endsWith('.md')) {
      files.push(relativePath);
    }
  }
  
  return files;
}

export function getAllDocs(): BrainDoc[] {
  const files = getFilesRecursively(BRAIN_DIR);
  
  return files.map(filePath => {
    const fullPath = path.join(BRAIN_DIR, filePath);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);
    
    const slug = filePath.replace(/\.md$/, '');
    const folder = path.dirname(filePath) === '.' ? 'root' : path.dirname(filePath).split('/')[0];
    
    return {
      slug,
      path: filePath,
      folder,
      title: data.title || path.basename(filePath, '.md'),
      tags: data.tags || [],
      date: data.date,
      created: data.created,
      related: data.related,
      content
    };
  });
}

export function getDocBySlug(slug: string): BrainDoc | null {
  const filePath = path.join(BRAIN_DIR, `${slug}.md`);
  
  if (!fs.existsSync(filePath)) return null;
  
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContents);
  
  const folder = path.dirname(slug) === '.' ? 'root' : path.dirname(slug).split('/')[0];
  
  return {
    slug,
    path: `${slug}.md`,
    folder,
    title: data.title || path.basename(slug),
    tags: data.tags || [],
    date: data.date,
    created: data.created,
    related: data.related,
    content
  };
}

export async function renderMarkdown(content: string): Promise<string> {
  // Process backlinks [[link]] -> clickable links
  const processedContent = content.replace(
    /\[\[([^\]]+)\]\]/g,
    '<a href="/doc/$1" class="backlink">$1</a>'
  );
  
  const result = await remark()
    .use(html, { sanitize: false })
    .process(processedContent);
  
  return result.toString();
}

export function getDocsByFolder(): BrainFolder[] {
  const docs = getAllDocs();
  
  const folderMap: Record<string, BrainDoc[]> = {};
  
  for (const doc of docs) {
    if (!folderMap[doc.folder]) {
      folderMap[doc.folder] = [];
    }
    folderMap[doc.folder].push(doc);
  }
  
  const folderConfig: Record<string, { icon: string; order: number }> = {
    root: { icon: '🏠', order: 0 },
    concepts: { icon: '💡', order: 1 },
    journals: { icon: '📅', order: 2 }
  };
  
  return Object.entries(folderMap)
    .map(([name, docs]) => ({
      name,
      icon: folderConfig[name]?.icon || '📁',
      docs: docs.sort((a, b) => {
        // Sort journals by date descending, others by title
        if (name === 'journals') {
          return (b.date || b.slug).localeCompare(a.date || a.slug);
        }
        return a.title.localeCompare(b.title);
      })
    }))
    .sort((a, b) => {
      const orderA = folderConfig[a.name]?.order ?? 99;
      const orderB = folderConfig[b.name]?.order ?? 99;
      return orderA - orderB;
    });
}

export function getAllTags(): { tag: string; count: number }[] {
  const docs = getAllDocs();
  const tagCounts: Record<string, number> = {};
  
  for (const doc of docs) {
    for (const tag of doc.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
