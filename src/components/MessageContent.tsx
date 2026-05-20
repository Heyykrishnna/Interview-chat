import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

type Props = {
  content: string;
  variant: 'user' | 'assistant';
};

export function MessageContent({ content, variant }: Props) {
  const isUser = variant === 'user';

  return (
    <div className={`msg-prose ${isUser ? 'msg-prose--user' : 'msg-prose--assistant'}`}>
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
            const isBlock = className?.includes('language-');
            if (isBlock) {
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
            <a href={href} target="_blank" rel="noopener noreferrer" className="msg-link">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="msg-list">{children}</ul>,
          ol: ({ children }) => <ol className="msg-list msg-list--ordered">{children}</ol>,
          li: ({ children }) => <li className="msg-list-item">{children}</li>,
          p: ({ children }) => <p className="msg-paragraph">{children}</p>,
          strong: ({ children }) => <strong className="msg-strong">{children}</strong>,
          em: ({ children }) => <em className="msg-em">{children}</em>,
          h1: ({ children }) => <h3 className="msg-heading">{children}</h3>,
          h2: ({ children }) => <h3 className="msg-heading">{children}</h3>,
          h3: ({ children }) => <h3 className="msg-heading">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="msg-quote">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
