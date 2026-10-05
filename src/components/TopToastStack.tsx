import type { ReactNode } from "react";

/** Every toast stacks at the top center of the window, newest below, never in a corner. */
export function TopToastStack({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none fixed top-[8px] left-1/2 z-[100] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-stretch gap-2 [&>*]:pointer-events-auto">{children}</div>;
}
