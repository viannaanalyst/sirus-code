import { useRef } from "react";
interface Props { onResize: (delta: number) => void; value: number; }
export function ResizeHandle({ onResize, value }: Props) {
  const lastX = useRef<number | null>(null);
  return (
    <div role="separator" aria-orientation="vertical" aria-valuenow={value} aria-valuemin={220} aria-valuemax={480} tabIndex={0}
      className="group relative z-10 w-1 shrink-0 cursor-ew-resize touch-none before:absolute before:-inset-x-1.5 before:inset-y-0 before:content-['']"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onResize((event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 32 : 8)); }
      }}
      onPointerDown={(event) => { lastX.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (lastX.current === null) return; onResize(event.clientX - lastX.current); lastX.current = event.clientX; }}
      onPointerUp={() => { lastX.current = null; }} onLostPointerCapture={() => { lastX.current = null; }}>
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-accent/40" />
    </div>
  );
}
