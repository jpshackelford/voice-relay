import { Link } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked for GitHub Flavored Markdown
marked.setOptions({
  gfm: true,
  breaks: true,
});

interface LegalPageProps {
  title: string;
  content: string;
  loading?: boolean;
  error?: string;
}

/**
 * Parse markdown to sanitized HTML using marked + DOMPurify.
 */
function parseMarkdown(text: string): string {
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml);
}

/**
 * Shared layout component for legal pages (ToS, Privacy Policy).
 */
export function LegalPage({ title, content, loading, error }: LegalPageProps) {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <header className="legal-header">
          <Link to="/login" className="legal-back">
            ← Back to Login
          </Link>
          <h1>{title}</h1>
        </header>

        <main className="legal-content">
          {loading && (
            <div className="legal-loading">Loading...</div>
          )}
          {error && (
            <div className="legal-error">{error}</div>
          )}
          {!loading && !error && (
            <div
              className="markdown-content"
              dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
            />
          )}
        </main>

        <footer className="legal-footer">
          <Link to="/tos">Terms of Service</Link>
          <span className="legal-footer-divider">•</span>
          <Link to="/privacy">Privacy Policy</Link>
        </footer>
      </div>
    </div>
  );
}
