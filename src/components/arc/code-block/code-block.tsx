"use client";

import { useTranslation } from "@/i18n/use-translation";
import { SearchText } from "@/components/SearchText";
import { codeChunks, shouldHighlight } from "@/lib/code-chunks";
import { normaliseLanguage, tokenKind, tokenPattern } from "@/lib/code-tokens";
import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, FileCode2 } from "@/components/icons";
import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { useArcReducedMotion as useReducedMotion } from "../lib/use-arc-motion";
import { motionTokens } from "../lib/motion-tokens";
import { CopyButton } from "../copy-button/copy-button";
import styles from "./code-block.module.css";

export interface CodeBlockProps {
  /** Source shown in the block and copied by the action. */
  code: string;
  /** File name displayed in the header. */
  filename?: string;
  /** Used for the header label and lightweight syntax highlighting. */
  language?: string;
  /** Collapse longer sources to this many lines, with a toggle that expands the rest in place. */
  maxLines?: number;
  /** Live output updates in place without animating every chunk. */
  animateChanges?: boolean;
  searchQuery?: string;
  searchOffset?: number;
}

function highlight(code: string, language: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (cursor < index) parts.push(code.slice(cursor, index));

    const kind = tokenKind(value, code, index, language);
    parts.push(kind ? <span className={styles[kind]} key={`${index}-${value}`}>{value}</span> : <Fragment key={`${index}-${value}`}>{value}</Fragment>);
    cursor = index + value.length;
  }

  if (cursor < code.length) parts.push(code.slice(cursor));
  return parts;
}

const HighlightedChunk = memo(function HighlightedChunk({ text, language }: { text: string; language: string }) {
  return <>{highlight(text, language)}</>;
});

function Highlighted({ code, language }: { code: string; language: string }) {
  const plain = !shouldHighlight(code);
  const chunks = useMemo(() => plain ? [] : codeChunks(code, tokenPattern), [code, plain]);
  if (plain) return <>{code}</>;
  return <>{chunks.map((chunk, index) => <HighlightedChunk key={index} text={chunk} language={language} />)}</>;
}

const textEnter = { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } as const;
const textExit = { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] } as const;

/** Text that changes in place: the new words rise in with a soft blur while the old ones leave upward, faster. */
function SwapText({ value, reduced }: { value: string; reduced: boolean }) {
  return <AnimatePresence initial={false}>
    <motion.span key={value} className={styles.swapText} initial={reduced ? false : { opacity: 0, y: "0.3em", filter: `blur(${motionTokens.blur.soft}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: "-0.3em", filter: `blur(${motionTokens.blur.subtle}px)`, transition: textExit }} transition={reduced ? { duration: 0 } : textEnter}>{value}</motion.span>
  </AnimatePresence>;
}

/** A new file name swaps in while its box follows the new width on a spring, then returns to auto so it can still truncate. */
function FileName({ name, reduced }: { name: string; reduced: boolean }) {
  const sizer = useRef<HTMLSpanElement>(null);
  const rest = useRef(0);
  const width = useMotionValue<number | "auto">("auto");
  useEffect(() => {
    const node = sizer.current;
    if (!node) return;
    const observer = new ResizeObserver(() => { rest.current = node.offsetWidth; });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const moving = width.get(), to = sizer.current?.offsetWidth ?? 0;
    const from = typeof moving === "number" ? moving : rest.current;
    rest.current = to;
    if (reduced || !from || !to || Math.abs(from - to) < 1) { width.jump("auto"); return; }
    width.jump(from);
    const controls = animate(width, to, { ...motionTokens.spring.morph, onComplete: () => width.jump("auto") });
    return () => controls.stop();
  }, [name, reduced, width]);
  return <motion.span className={`${styles.swap} ${styles.filename}`} style={{ width }}>
    <span ref={sizer} className={styles.sizer} aria-hidden="true">{name}</span>
    <span className={styles.swapStack} aria-hidden="true"><SwapText value={name} reduced={reduced} /></span>
    <span className={styles.srOnly}>{name}</span>
  </motion.span>;
}

export function CodeBlock({ code, filename, language = "tsx", maxLines, animateChanges = true, searchQuery = "", searchOffset = 0 }: CodeBlockProps) {
  const t = useTranslation();
  const displayLanguage = normaliseLanguage(language);
  // Highlighting is the costliest part of a render: chunks that did not change are reused.
  const highlighted = <Highlighted code={code} language={displayLanguage} />;
  const reduced = useReducedMotion() ?? false;
  const preId = useId();
  const lineCount = code.split("\n").length;
  const collapsible = maxLines != null && maxLines > 0 && lineCount > maxLines;
  const [expanded, setExpanded] = useState(false);
  const open = !collapsible || expanded;
  const preRef = useRef<HTMLPreElement>(null);
  const measured = useRef<{ full: number; collapsed: number } | null>(null);
  // Before the first measurement the clip height comes from CSS, so the server render is already collapsed.
  const height = useMotionValue<number | string>(open ? "auto" : "var(--code-collapsed)");
  const target = useRef({ open, reduced });
  const settleRef = useRef<(instant: boolean) => void>(() => {});

  // The source area follows its content on a spring: expanding, collapsing, and new code all resize smoothly.
  useLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const settle = (instant: boolean) => {
      const sizes = measured.current;
      if (!sizes) return;
      const next = target.current.open ? sizes.full : sizes.collapsed;
      if (instant || target.current.reduced || typeof height.get() !== "number") height.jump(next);
      else animate(height, next, motionTokens.spring.smooth);
    };
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(pre);
      const full = pre.offsetHeight;
      const collapsed = maxLines ? Math.min(full, Math.round(maxLines * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom))) : full;
      const first = !measured.current;
      measured.current = { full, collapsed };
      settle(first);
    });
    observer.observe(pre);
    settleRef.current = settle;
    return () => observer.disconnect();
  }, [height, maxLines]);
  useLayoutEffect(() => { target.current = { open, reduced }; settleRef.current(false); }, [open, reduced]);
  const expandLabels = [t("code.showLines", { count: lineCount }), t("Show fewer lines")];

  return (
    <section className={styles.block} aria-label={t("code.sourceLabel", { name: filename ?? displayLanguage })} style={maxLines ? { "--code-lines": maxLines } as CSSProperties : undefined}>
      <header className={styles.header}>
        <div className={styles.file}>
          <FileCode2 size={16} strokeWidth={1.75} aria-hidden="true" />
          <FileName name={filename ?? t("Source code")} reduced={reduced} />
          <span className={styles.language}>{displayLanguage}</span>
        </div>
        <CopyButton value={code} label={t("Copy code")} />
      </header>
      <motion.div className={styles.viewport} style={{ height }}>
        <pre ref={preRef} id={preId} className={styles.pre} tabIndex={0} aria-label={t("Selectable source code")}>
          {animateChanges ? <AnimatePresence initial={false} mode="popLayout">
            <motion.code key={code} className={styles.code} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: textExit }} transition={reduced ? { duration: 0 } : textEnter}>{highlighted}</motion.code>
          </AnimatePresence> : <code className={styles.code}>{searchQuery.trim() ? <SearchText text={code} query={searchQuery} offset={searchOffset} /> : highlighted}</code>}
        </pre>
      </motion.div>
      {collapsible && <button type="button" className={styles.expand} aria-expanded={expanded} aria-controls={preId} onClick={() => setExpanded(value => !value)}>
        {/* Both labels reserve the cell, so the chevron never moves when the words change. */}
        <span className={styles.swap} aria-hidden="true">{expandLabels.map(text => <span key={text} className={styles.reserve}>{text}</span>)}<span className={styles.swapStack}><SwapText value={expandLabels[expanded ? 1 : 0]} reduced={reduced} /></span></span>
        <span className={styles.srOnly}>{expandLabels[expanded ? 1 : 0]}</span>
        <motion.span className={styles.chevron} aria-hidden="true" initial={false} animate={{ rotate: expanded ? 180 : 0 }} transition={reduced ? { duration: 0 } : motionTokens.spring.snappy}><ChevronDown size={16} strokeWidth={1.8} /></motion.span>
      </button>}
    </section>
  );
}
