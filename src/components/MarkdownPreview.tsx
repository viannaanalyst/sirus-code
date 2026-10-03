import { useMemo, type ReactNode } from "react";
import { client } from "@/client";
import { CodeBlock } from "@/components/arc/code-block/code-block";
import { cn } from "@/lib/cn";
import { parseInline, parseMarkdown } from "@/lib/markdown";

function inline(text: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    switch (token.kind) {
      case "bold":
        return <strong key={index} className="font-semibold text-text-primary">{token.text}</strong>;
      case "italic":
        return <em key={index}>{token.text}</em>;
      case "code":
        return <code key={index} className="rounded-[4px] bg-background-3 px-1 py-0.5 font-mono ui-micro">{token.text}</code>;
      case "link":
        return /^https?:\/\//i.test(token.url)
          ? <button key={index} type="button" className="text-accent underline underline-offset-2 hover:opacity-80"
              onClick={() => { void client.openExternalUrl(token.url).catch(() => undefined); }}>{token.text}</button>
          : <span key={index} className="underline underline-offset-2">{token.text}</span>;
      default:
        return <span key={index}>{token.text}</span>;
    }
  });
}

/** Read-only rendered markdown for the editor preview toggle. */
export function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="scroll-thin h-full overflow-y-auto px-4 py-3">
    <div className="mx-auto max-w-[72ch] space-y-3 ui-chat text-text-secondary">
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <CodeBlock key={index} code={block.content} language={block.language} animateChanges={false} />;
        }
        if (block.kind === "heading") {
          const Tag = (`h${Math.min(block.level, 6)}`) as "h1";
          const className = block.level === 1
            ? "ui-section-title text-text-primary"
            : block.level === 2
              ? "ui-control font-semibold text-text-primary"
              : "ui-body font-semibold text-text-primary";
          return <Tag key={index} className={className}>{inline(block.text)}</Tag>;
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return <Tag key={index} className={cn("ml-5 space-y-1", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}
          </Tag>;
        }
        if (block.kind === "quote") {
          return <blockquote key={index} className="border-l-2 border-border-default pl-3 text-text-muted">{inline(block.text)}</blockquote>;
        }
        if (block.kind === "rule") {
          return <hr key={index} className="border-border-subtle" />;
        }
        return <p key={index} className="whitespace-pre-wrap leading-relaxed">{inline(block.text)}</p>;
      })}
    </div>
  </div>;
}
