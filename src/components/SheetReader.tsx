import { useMemo, useRef, useState } from "react";
import type { DocumentSheet } from "@/client/types";
import { columnName } from "@/lib/document-reader";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";

export function SheetReader({ sheets, zoom }: { sheets: DocumentSheet[]; zoom: number }) {
  const t = useTranslation();
  const [index, setIndex] = useState(0);
  const sheet = sheets[index];
  return <div className="flex min-h-0 flex-1 flex-col">
    {sheet ? <SheetGrid key={index} sheet={sheet} zoom={zoom} /> : <p className="p-6 text-text-muted">{t("reader.empty")}</p>}
    <div className="scroll-thin flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border-subtle bg-background-1 px-2 py-1" aria-label={t("reader.sheet")}>
      {sheets.map((item, i) => <button type="button" key={i} aria-pressed={index === i} className={cn("shrink-0 rounded px-3 py-1.5 ui-caption", i === index ? "bg-background-3 text-text-primary" : "text-text-muted hover:bg-background-2")} onClick={() => setIndex(i)}>{item.name}</button>)}
    </div>
    <p className="shrink-0 border-t border-border-subtle px-3 py-2 ui-caption text-text-muted">{t("reader.sheetNote")}</p>
  </div>;
}

function SheetGrid({ sheet, zoom }: { sheet: DocumentSheet; zoom: number }) {
  const t = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState({ row: 0, column: 0 });
  const [top, setTop] = useState(0);
  const cells = useMemo(() => new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.column}`, cell])), [sheet]);
  const current = cells.get(`${selected.row}:${selected.column}`);
  const rowHeight = 32 * zoom;
  const first = Math.max(0, Math.floor(top / rowHeight) - 3);
  const last = Math.min(sheet.rows, first + 60);
  const selectCell = (row: number, column: number, focus = false) => {
    setSelected({ row, column });
    if (!focus || !scroller.current) return;
    const area = scroller.current;
    if (row * rowHeight < area.scrollTop || (row + 2) * rowHeight > area.scrollTop + area.clientHeight) area.scrollTop = Math.max(0, row * rowHeight - rowHeight);
    requestAnimationFrame(() => area.querySelector<HTMLButtonElement>(`[data-cell="${row}:${column}"]`)?.focus());
  };
  return <>
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2">
      <span className="w-12 shrink-0 font-mono ui-caption text-text-secondary">{columnName(selected.column)}{selected.row + 1}</span><span className="text-text-muted" aria-hidden="true">ƒx</span>
      <input readOnly aria-label={t("reader.value")} value={current?.formula ? `=${current.formula}` : current?.value ?? ""} className="selectable min-w-0 flex-1 rounded bg-background-2 px-2 py-1 font-mono ui-caption text-text-primary" />
    </div>
    <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-auto bg-background-1" onScroll={(event) => setTop(event.currentTarget.scrollTop)} tabIndex={0} aria-label={sheet.name}>
      {!sheet.rows ? <p className="p-6 text-text-muted">{t("reader.empty")}</p> : <table className="border-separate border-spacing-0 text-left" style={{ fontSize: `${12 * zoom}px` }}>
        <thead className="sticky top-0 z-10 bg-background-3"><tr><th scope="col" className="sticky left-0 z-20 min-w-10 border-b border-r border-border-subtle bg-background-3" aria-label={t("reader.cell", { cell: "" })} />{Array.from({ length: sheet.columns }, (_, column) => <th key={column} scope="col" className="min-w-28 border-b border-r border-border-subtle px-3 py-2 text-center font-normal text-text-muted">{columnName(column)}</th>)}</tr></thead>
        <tbody>
          {first > 0 ? <tr aria-hidden="true"><td colSpan={sheet.columns + 1} style={{ height: first * rowHeight }} /></tr> : null}
          {Array.from({ length: Math.max(0, last - first) }, (_, offset) => { const row = first + offset; return <tr key={row}>
            <th scope="row" className="sticky left-0 min-w-10 border-b border-r border-border-subtle bg-background-3 px-2 text-center font-normal text-text-muted">{row + 1}</th>
            {Array.from({ length: sheet.columns }, (_, column) => { const cell = cells.get(`${row}:${column}`); return <td key={column} className="border-b border-r border-border-subtle p-0"><button type="button" data-cell={`${row}:${column}`} tabIndex={selected.row === row && selected.column === column ? 0 : -1} aria-label={t("reader.cell", { cell: `${columnName(column)}${row + 1}` })} aria-pressed={selected.row === row && selected.column === column} className="block w-full max-w-[320px] truncate px-3 text-left text-text-secondary hover:bg-background-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent/10" style={{ height: rowHeight }} title={cell?.value} onClick={() => selectCell(row, column)} onKeyDown={(event) => {
              const direction = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
              if (!direction) return;
              event.preventDefault(); selectCell(Math.max(0, Math.min(sheet.rows - 1, row + direction[0])), Math.max(0, Math.min(sheet.columns - 1, column + direction[1])), true);
            }}>{cell?.value || (cell?.formula ? `=${cell.formula}` : "\u00a0")}</button></td>; })}
          </tr>; })}
          {last < sheet.rows ? <tr aria-hidden="true"><td colSpan={sheet.columns + 1} style={{ height: (sheet.rows - last) * rowHeight }} /></tr> : null}
        </tbody>
      </table>}
    </div>
  </>;
}
