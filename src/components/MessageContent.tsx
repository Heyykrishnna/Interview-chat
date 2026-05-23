import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

type Props = {
  content: string;
  variant: 'user' | 'assistant';
};

export function MessageContent({ content, variant }: Props) {
  return (
    <div className={`msg-prose msg-prose--${variant}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children, node }) => {
            const codeEl = (node as { children?: { properties?: { className?: string[] } }[] })?.children?.[0];
            const lang = codeEl?.properties?.className?.[0]?.replace('language-', '') ?? 'code';
            return (
              <div className="code-block-wrap">
                <div className="code-block-bar">
                  <span className="code-dot code-dot--r" />
                  <span className="code-dot code-dot--y" />
                  <span className="code-dot code-dot--g" />
                  <span className="code-lang">{lang}</span>
                </div>
                <pre className="code-pre">{children}</pre>
              </div>
            );
          },
          code: ({ className, children, ...props }) => {
            if (className?.includes('language-')) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
