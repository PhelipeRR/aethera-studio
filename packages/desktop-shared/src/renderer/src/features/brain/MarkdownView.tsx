import { useState } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { Link } from 'react-router';
import { Check, Copy } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import type { LinkRef } from '@neuralbridge/shared/brain';
import { codeContent } from './markdown-code';
import { linkifyWikiLinks, MEMORY_LINK_PREFIX } from './wikilinks';

function CopyCodeButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(content).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Código copiado' : 'Copiar código'}
      className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/90 px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

/**
 * Renders memory content, which any agent may have written: no raw HTML (react-markdown default),
 * no remote images (alt text instead), no navigation to external links (shown as text with the URL).
 * [[Links]] go to the target memory, or show as pending when it does not exist yet.
 */
export function MarkdownView({ content, links }: { content: string; links: LinkRef[] }) {
  const byTitle = new Map(links.filter((link) => link.id).map((link) => [link.title.toLowerCase(), link.id as string]));
  return (
    <div className="markdown max-w-[72ch] text-[15px] leading-7">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith(MEMORY_LINK_PREFIX) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(MEMORY_LINK_PREFIX)) {
              const title = decodeURIComponent(href.slice(MEMORY_LINK_PREFIX.length));
              const id = byTitle.get(title.toLowerCase());
              return id ? (
                <Link to={`/memory/${id}`} className="text-primary underline underline-offset-4 hover:no-underline">
                  {children}
                </Link>
              ) : (
                <span className="text-muted-foreground underline decoration-dashed underline-offset-4" title={`"${title}" ainda não existe`}>
                  {children}
                </span>
              );
            }
            return (
              <span className="underline decoration-dotted underline-offset-4" title={href}>
                {children}
                {href && <span className="ml-1 font-mono text-xs text-muted-foreground">({href})</span>}
              </span>
            );
          },
          img: ({ alt }) => <span className="text-muted-foreground">[imagem: {alt || 'sem descrição'}]</span>,
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className }) => {
            const content = codeContent(children);
            const block = className?.startsWith('language-') || content.includes('\n');
            if (!block) return <code className={className}>{children}</code>;
            return (
              <div className="relative my-3">
                <CopyCodeButton content={content} />
                <pre className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
                  <code className={className}>{children}</code>
                </pre>
              </div>
            );
          },
        }}
      >
        {linkifyWikiLinks(content)}
      </Markdown>
    </div>
  );
}
