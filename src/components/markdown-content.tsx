import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ source }: { source: string }) {
  return (
    <div className="markdown-content wrap-anywhere leading-8">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>
          ),
        }}
      >{source}</Markdown>
    </div>
  );
}
