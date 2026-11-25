import { useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

type Props = {
  content: string;
  variant: 'user' | 'assistant';
};

function CodeBlock({ lang, children }: { lang: string; children: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="code-block-wrap">
      <div className="code-block-bar">
        <span className="code-dot code-dot--r" />
        <span className="code-dot code-dot--y" />
        <span className="code-dot code-dot--g" />
        <span className="code-lang">{lang}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="code-copy-btn"
          title="Copy code"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre ref={preRef} className="code-pre">
        {children}
      </pre>
    </div>
  );
}

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
            return <CodeBlock lang={lang}>{children}</CodeBlock>;
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
