import { renderMarkdown } from '@/lib/cms/markdown'

/**
 * Renders CMS Markdown on the server as sanitized HTML (lib/cms/markdown.ts).
 * Styling lives in the `.cms-content` rules of globals.css.
 */
export function CmsContent({ markdown, className }: { markdown: string; className?: string }) {
  const html = renderMarkdown(markdown)
  return (
    <div
      className={className ? `cms-content ${className}` : 'cms-content'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
