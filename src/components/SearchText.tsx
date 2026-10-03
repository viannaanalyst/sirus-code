import { Fragment } from "react";
import { textMatches } from "@/lib/conversation-search";

export function SearchText({ text, query, offset = 0 }: { text: string; query: string; offset?: number }) {
  const matches = textMatches(text, query);
  if (!matches.length) return text;
  let cursor = 0;
  const parts = matches.map(match => {
    const prefix = text.slice(cursor, match.start);
    cursor = match.end;
    return <Fragment key={match.start}>{prefix}<mark data-search-start={offset + match.start} className="rounded-sm bg-accent/25 text-text-primary">{text.slice(match.start, match.end)}</mark></Fragment>;
  });
  return <>{parts}{text.slice(cursor)}</>;
}
