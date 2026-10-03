export function ShortcutHint({ keys }: { keys: string }) {
  const parts = keys.replace("Meta", "⌘").replace("Cmd", "⌘").split("+");
  return (
    <span className="flex items-center gap-0.5 text-text-muted">
      {parts.map((part) => (
        <kbd
          key={part}
          className="min-w-[16px] rounded-[4px] border border-border-subtle bg-background-2 px-1 ui-micro"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}
