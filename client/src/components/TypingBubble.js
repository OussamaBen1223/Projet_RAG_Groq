import React from 'react';
import { useTypingEffect } from '../hooks/useTypingEffect';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function TypingBubble({ text, sources = [], animate, onSourceClick }) {
  const displayed = useTypingEffect(text, animate);
  const showCursor = animate && displayed.length < text.length;

  // Pré-traitement : transforme les citations [1], [2] en liens Markdown factices
  // ex: [1] -> [ [1] ](#source-1)
  const preprocessCitations = (textToRender) => {
    if (!textToRender) return "";
    return textToRender.replace(/\[(\d+)\]/g, (match, id) => `[${match}](#source-${id})`);
  };

  const processedText = preprocessCitations(displayed) + (showCursor ? " |" : "");

  return (
    <div className="bubble bubble-ai transition-bubble">
      <span className="bubble-label">IA</span>
      <div className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, href, children, ...props }) => {
              // Intercepte nos liens factices pour afficher les boutons de citation
              if (href?.startsWith('#source-')) {
                const sourceId = parseInt(href.replace('#source-', ''), 10);
                const source = sources.find(s => s.id === sourceId) || sources[sourceId - 1];
                if (source) {
                  return (
                    <button
                      className="citation-link"
                      onClick={(e) => { e.preventDefault(); onSourceClick && onSourceClick(source); }}
                      title={source.source ? `Voir la source : ${source.source}` : `Voir la source`}
                    >
                      {children}
                    </button>
                  );
                }
              }
              // Liens standards
              return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
            }
          }}
        >
          {processedText}
        </ReactMarkdown>
      </div>
      {sources?.length > 0 && (
        <div className="bubble-sources">
          <span className="bubble-sources-title">Sources utilisées :</span>
          {sources.map((src, i) => (
            <button
              key={i}
              className="bubble-source-btn"
              onClick={() => onSourceClick && onSourceClick(src)}
            >
              {src.source ? `📄 ${src.source}` : `📄 Source ${src.id || i + 1}`}
              {src.page ? ` (p.${src.page})` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
