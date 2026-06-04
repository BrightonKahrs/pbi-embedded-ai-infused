import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MessageMarkdownProps {
  content: string;
  /** Extra className appended to the wrapping `.ai-md` div. */
  className?: string;
}

const components: Components = {
  p: ({ node, ...props }) => (
    <p style={{ margin: '0 0 8px 0' }} {...props} />
  ),
  // ReactMarkdown injects children at runtime, so jsx-a11y can't see the
  // heading/anchor content statically. Suppress the false positives.
  h1: ({ node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3 className="ai-md-h1" {...props} />
  ),
  h2: ({ node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3 className="ai-md-h2" {...props} />
  ),
  h3: ({ node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h3 className="ai-md-h3" {...props} />
  ),
  h4: ({ node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/heading-has-content
    <h4 className="ai-md-h4" {...props} />
  ),
  a: ({ node, ...props }) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content
    <a target="_blank" rel="noopener noreferrer" {...props} />
  ),
  table: ({ node, ...props }) => (
    <div className="ai-md-table-wrap">
      <table className="ai-md-table" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="ai-md-thead" {...props} />,
  tbody: ({ node, ...props }) => <tbody className="ai-md-tbody" {...props} />,
  tr: ({ node, ...props }) => <tr className="ai-md-tr" {...props} />,
  th: ({ node, ...props }) => <th className="ai-md-th" {...props} />,
  td: ({ node, ...props }) => <td className="ai-md-td" {...props} />,
  code: ({ node, className, children, ...props }: any) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="ai-md-code-inline" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={`ai-md-code-block ${className ?? ''}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ node, ...props }) => <pre className="ai-md-pre" {...props} />,
  ul: ({ node, ...props }) => <ul className="ai-md-ul" {...props} />,
  ol: ({ node, ...props }) => <ol className="ai-md-ol" {...props} />,
  li: ({ node, ...props }) => <li className="ai-md-li" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className="ai-md-blockquote" {...props} />
  ),
  hr: () => <hr className="ai-md-hr" />,
};

/**
 * Renders trusted assistant markdown (GitHub-flavored). Do NOT use for
 * user-supplied text — we don't escape HTML that the model emits, only the
 * raw HTML pass-through is disabled by react-markdown default (no
 * `rehype-raw`). This keeps tables, bold, headings, and code blocks visible
 * instead of showing the literal markdown syntax in the chat bubble.
 */
const MessageMarkdown: React.FC<MessageMarkdownProps> = ({
  content,
  className,
}) => {
  return (
    <div className={`ai-md ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(MessageMarkdown);
