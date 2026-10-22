import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ source }: { source: string }) {
  return (
    <div className="markdown-content wrap-anywhere leading-8">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        urlTransform={(value) => {
          if (/^(?:\/|#|\.\/|\.\.\/)/.test(value)) return value;
          try {
            return ["http:", "https:", "mailto:"].includes(new URL(value).protocol) ? value : "";
          } catch {
            return "";
          }
        }}
        components={{
          a: ({ href, children }) => href ? (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="underline underline-offset-2">{children}</a>
          ) : <span>{children}</span>,
        }}
      >{source}</Markdown>
    </div>
  );
}
