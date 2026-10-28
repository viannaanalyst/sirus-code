import { Fragment } from "react";
import { textMatches } from "@/lib/conversation-search";

export function SearchText({ text, query, offset = 0 }: { text: string; query: string; offset?: number }) {
  const matches = textMatches(text, query);
  if (!matches.length) return text;
  const parts = matches.map((match, index) => {
    const prefix = text.slice(index ? matches[index - 1].end : 0, match.start);
    return <Fragment key={match.start}>{prefix}<mark data-search-start={offset + match.start} className="rounded-sm bg-accent/25 text-text-primary">{text.slice(match.start, match.end)}</mark></Fragment>;
  });
  return <>{parts}{text.slice(matches[matches.length - 1].end)}</>;
}
