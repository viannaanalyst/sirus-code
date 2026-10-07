import { client } from "@/client";
import { appendAttachments, isAttachmentPaste, pastedFiles } from "@/lib/composer-attachments";
import { formatUnknownError } from "@/lib/format-error";
import { Textarea } from "@/components/arc/textarea/textarea";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useTranslation } from "@/i18n/use-translation";
import { Check, ChevronDown, ClipboardList, Hand, Shield, ShieldAlert, Square, ArrowUp, ListPlus, Minimize2 } from "@/components/icons/phosphor";
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AgentInstall, AgentProviderId, ApprovalMode, ExecutionOptions, Session } from "@/client/types";
import { ComposerAddMenu, ComposerContextChips } from "@/components/ComposerAddMenu";
import { ComposerContour } from "@/components/ComposerContour";
import { ComposerSuggestions } from "@/components/ComposerSuggestions";
import { useComposerSuggestions } from "@/lib/use-composer-suggestions";
import { composerSegments, hasComposerTokens } from "@/lib/composer-tokens";
import { ComposerDictationButton } from "@/components/ComposerDictationButton";
import { ContextMeter } from "@/components/ContextMeter";
import { ComposerPromptQueue } from "@/components/ComposerPromptQueue";
import { UsageLimitNotice } from "@/components/UsageLimitNotice";
import { ComposerMcpCard, ComposerStatusCard, RenameSessionDialog } from "@/components/ComposerCommandPanels";
import { ScriptRunNotice } from "@/components/ScriptRunNotice";
import { conversationMarkdown, REVIEW_PROMPT, type ComposerCommandId } from "@/lib/composer-commands";
import { lastAssistantId } from "@/lib/prompt-queue";
import { canSteer } from "@/lib/steering";
import { effectiveShortcut, shortcutLabel } from "@/lib/keybindings";
import { shortcutMatches } from "@/lib/shortcuts";
import { COMPACTING_PROVIDERS, shouldCompactBeforeSend } from "@/lib/compact-before-send";
import { HandoffCard } from "@/components/HandoffCard";
import { QUICK_REPLY_EVENT, type QuickReplyDetail } from "@/components/ReplyChoices";
import { modelExecutionControls, supportsPlanning } from "@/lib/execution-options";
import { ModelSelector } from "@/components/ModelSelector";
import { modelKey, parseModelKey } from "@/lib/settings";
import { providerById } from "@/lib/provider-registry";
import { cn } from "@/lib/cn";
import { composerPopoverLayout } from "@/lib/popover-position";
import { motionTokens, pressScale } from "@/lib/motion";
import { composerContextForOwner, composerPlanning, composerPrompt, emptyComposerContext } from "@/lib/composer-context";
import { splitPromptContext } from "@/lib/prompt-context";
import { readStash, recallStep, writeStash, type Recall } from "@/lib/prompt-recall";
import { ComposerStash } from "@/components/ComposerStash";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/primitives/Dropdown";
import { Tooltip } from "@/primitives/Tooltip";
import { Popover, PopoverAnchor } from "@/primitives/Popover";
import { selectCurrentProject, useAppStore } from "@/store/app-store";

interface Props {
  session: Session | null;
  agents: AgentInstall[];
  disabled?: boolean;
  onSend: (prompt: string, execution?: ExecutionOptions) => Promise<boolean>;
  onStop: () => void;
  onModelChange?: (provider: AgentProviderId, model: string | null) => void;
}

function fitComposerHeight(node: HTMLTextAreaElement) {
  // CSS owns the minimum/maximum; measure wrapped text after releasing the old height.
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function AgentComposerView({ session, disabled, onSend, onStop, onModelChange }: Props) {
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const draftProjectId = useAppStore((state) => state.selectedProjectId);
  const draftKey = session ? `session:${session.id}` : `project:${draftProjectId}`;
  const value = useAppStore((state) => state.composerDrafts[draftKey] ?? "");
  const updateDraft = useAppStore((state) => state.setComposerDraft);
  // `/skill` and `@file` tokens are painted by a mirror behind the transparent textarea text.
  const highlighted = hasComposerTokens(value);
  const mirror = useRef<HTMLDivElement>(null);
  const setValue = (next: string) => updateDraft(draftKey, next);
  const [sending, setSending] = useState(false);
  const [queueSending, setQueueSending] = useState(false);
  const enqueueRef = useRef(false);
  const [pasting, setPasting] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const pastingRef = useRef(false);
  const draftContext = useAppStore((state) => state.composerContexts[draftKey]);
  const context = draftContext ?? { ...emptyComposerContext, goal: session?.goal ?? "" };
  const setContext = useAppStore((state) => state.setComposerContext);
  const changeContext = (next: typeof context) => setContext(draftKey, next);
  const sendingRef = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const boundary = useRef<HTMLDivElement>(null);
  const approvalTrigger = useRef<HTMLButtonElement>(null);
  const [approvalLayout, setApprovalLayout] = useState({ sideOffset: 6, alignOffset: 0, width: 320 });
  const project = useAppStore(selectCurrentProject);
  const settings = useAppStore((state) => state.settings);
  const running = session?.status === "running" || session?.status === "starting" || session?.status === "waiting";
  const queued = useAppStore(state => Boolean(session && state.promptQueues[session.id]?.items.length));
  const queueing = running || queued;
  const installs = useAppStore((state) => state.agents);
  const providerReady = installs.some((item) => item.installed && item.id === (session?.agent ?? settings.defaultAgent) && (session !== null || !settings.disabledProviders.includes(item.id)));
  const canType = Boolean(session || project) && !disabled;
  const modelChanging = useAppStore((state) => Boolean(session && state.modelChangesPending[session.id]));
  const agentId = session?.agent ?? settings.defaultAgent;
  const astroName = useAppStore((state) => session?.astro ? state.astros?.find((item) => item.id === session.astro)?.name ?? null : null);
  const astroApproval = useAppStore((state) => session?.astro ? state.astros?.find((item) => item.id === session.astro)?.approval : undefined);
  const definition = providerById(agentId);
  const approvalPolicy = definition.approvalPolicy;
  // Without a choice in this draft, keep the mode last used: this session's own, or for a new
  // thread the project's most recent session with this provider. Never a global grant.
  const rememberedApproval = useAppStore((state) => {
    // An Astro's conversation follows the mode saved on the Astro (ADR-088).
    if (session) return session.agent === agentId ? astroApproval ?? session.execution?.approval ?? undefined : undefined;
    let latest: { at: string; approval: ApprovalMode } | null = null;
    for (const row of state.sessions) {
      const used = row.execution?.approval;
      if (row.projectId !== draftProjectId || row.agent !== agentId || !used) continue;
      if (!latest || row.lastActivityAt > latest.at) latest = { at: row.lastActivityAt, approval: used };
    }
    return latest?.approval;
  });
  const selectedApproval = context.approvalByProvider?.[agentId] ?? rememberedApproval;
  const requestedApproval = selectedApproval && definition.approvalModes.includes(selectedApproval) ? selectedApproval : definition.approvalModes[0] ?? "ask";
  const approval = context.planning && requestedApproval === "full" ? agentId === "cursor" ? "auto" : "ask" : requestedApproval;
  const approvalLabel = approval === "full" ? "composer.fullAccess" : approval === "auto" ? "composer.autoReview" : approvalPolicy === "vendor" ? "composer.vendorApproval" : "composer.askApproval";
  const fullAccess = approval === "full" && !context.planning;
  const defaultModel = parseModelKey(settings.defaultModel);
  const modelId = session ? session.model ?? null : defaultModel?.provider === agentId ? defaultModel.id : null;

  const catalogs = useAppStore((state) => state.modelsByProvider);
  const preference = settings.modelExecution[modelKey(agentId, modelId ?? "")] ?? {};
  const execution = modelExecutionControls(agentId, modelId, catalogs[agentId]?.models ?? [], preference);
  const planningAvailable = supportsPlanning(agentId, modelId);
  // Teams need a native planning coordinator and no team already in flight on this session.
  const teamAvailable = ["codex", "claude", "opencode"].includes(agentId) && !session?.teamWorker && !session?.sideChat
    && !(session?.team && ["planning", "proposed", "running", "ready"].includes(session.team.status));
  const submitting = (sending && !running) || queueSending;
  const canSend = (value.trim().length > 0 || context.attachments.length > 0 || (context.snippets?.length ?? 0) > 0) && !dictating && !submitting && !pasting && !modelChanging && canType && providerReady && (!context.planning || planningAvailable);
  // Bound to the composer's owner, so switching conversations closes it.
  const [panel, setCommandPanel] = useState<{ kind: "status" | "rename" | "mcp"; owner: string } | null>(null);
  const commandPanel = panel?.owner === draftKey ? panel.kind : null;
  const fastToggle = Boolean(modelId) && execution.fastAvailable && !(agentId === "cursor" && !execution.parameterized);
  const executionFor = (planning: boolean): ExecutionOptions => {
    const turnApproval = planning && requestedApproval === "full" ? agentId === "cursor" ? "auto" : "ask" : requestedApproval;
    return { effort: agentId === "cursor" && !execution.parameterized ? null : execution.effort, fast: agentId === "cursor" && !execution.parameterized ? false : execution.fast, planning, approval: definition.approvalModes.length ? turnApproval : null };
  };
  // App commands chosen from the `/` list (never sent as text, except `/compact`,
  // which the provider adapters map to their own compaction).
  const runCommand = (id: ComposerCommandId) => {
    const store = useAppStore.getState();
    const fail = (error: unknown) => useAppStore.setState({ error: formatUnknownError(error) });
    switch (id) {
      case "review": void onSend(REVIEW_PROMPT, executionFor(planningAvailable)); break;
      case "compact": void onSend("/compact", executionFor(context.planning)); break;
      case "status": case "rename": case "mcp": setCommandPanel({ kind: id, owner: draftKey }); break;
      case "fast": {
        const key = modelKey(agentId, modelId ?? "");
        void store.saveSettings({ ...store.settings, modelExecution: { ...store.settings.modelExecution, [key]: { ...store.settings.modelExecution[key], fast: !execution.fast } } });
        break;
      }
      case "fork": {
        const messageId = session ? lastAssistantId(session) : null;
        if (session && messageId) void store.forkSession(session.id, messageId);
        break;
      }
      case "export": {
        if (!session) break;
        void (async () => {
          if (!(await useAppStore.getState().ensureTranscript(session.id))) return;
          const current = useAppStore.getState().sessions.find((item) => item.id === session.id);
          if (!current) return;
          await client.exportConversation(current.id, conversationMarkdown(current, current.messages, { you: t("commands.export.you"), agent: t("commands.export.agent") }));
        })().catch(fail);
        break;
      }
      case "side": if (session) void store.openSideChat(session.id); break;
      case "new": store.requestNewSession(); break;
    }
  };
  const suggestions = useComposerSuggestions(draftKey, value, area, !canType || submitting || pasting || dictating || modelChanging, { context: { session, agent: agentId, fastAvailable: fastToggle }, run: runCommand });

  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    fitComposerHeight(node);
  }, [value, draftKey]);

  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    let width = node.getBoundingClientRect().width;
    const resize = () => fitComposerHeight(node);
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(node);
    document.fonts.addEventListener("loadingdone", resize);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", resize);
    };
  }, []);

  // Compact and send (T3 #16631): a heavy context idle past the provider's cache compacts first.
  const [now, setNow] = useState(() => Date.now());
  const heavy = Boolean(session?.contextUsage) && COMPACTING_PROVIDERS.has(agentId);
  useEffect(() => {
    if (!heavy) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [heavy, session?.lastActivityAt]);
  const compactFirst = !queueing && !context.team && shouldCompactBeforeSend(session, now);
  /**
   * `invert` (⌘Enter) flips the queue/steer preference for this one message; `skipCompact`
   * (Shift-click, or the plain send beside it) sends without compacting. Resolves whether it went out.
   */
  const send = async (invert = false, skipCompact = false): Promise<boolean> => {
    const guard = queueing ? enqueueRef : sendingRef;
    if (!canSend || guard.current) return false;
    guard.current = true;
    if (queueing) setQueueSending(true); else setSending(true);
    const submitted = value;
    const teamOwner = context.team ? draftKey : null;
    // Steering (opt-in): plain text goes into the running reply instead of the queue.
    if (session && settings.steerWhileRunning !== invert && canSteer(session.agent, session.status) && !context.attachments.length && !context.snippets?.length && !context.team && submitted.trim()) {
      try {
        const steered = await useAppStore.getState().steerTurn(session.id, submitted.trim());
        if (steered && (useAppStore.getState().composerDrafts[draftKey] ?? "") === submitted) setValue("");
        return steered;
      } finally {
        guard.current = false;
        setQueueSending(false); setSending(false);
      }
    }
    try {
      const options: ExecutionOptions = { effort: agentId === "cursor" && !execution.parameterized ? null : execution.effort, fast: agentId === "cursor" && !execution.parameterized ? false : execution.fast, planning: context.planning, approval: definition.approvalModes.length ? approval : null };
      const sent = session && compactFirst && !skipCompact
        ? await useAppStore.getState().compactAndSend(composerPrompt(submitted, context), options, session.id)
        : await onSend(composerPrompt(submitted, context), options);
      // A team request is one-shot: the next message talks to the coordinator normally.
      if (sent && teamOwner) {
        const state = useAppStore.getState();
        const current = state.composerContexts[teamOwner];
        if (current?.team) state.setComposerContext(teamOwner, { ...current, team: false });
      }
      return sent;
    } finally {
      guard.current = false;
      if (queueing) setQueueSending(false); else setSending(false);
    }
  };
  // ⌥⌘↩ (customizable): send like Enter, then open a new thread in this project (T3's "send and new").
  const sendNewCombo = effectiveShortcut(settings.customShortcuts, "send-new-thread");
  const sendAndStartNew = async () => { if (await send()) useAppStore.getState().requestNewSession(); };
  // Reply choices under the last answer (ReplyChoices): an option is sent as the reply, unless a
  // draft is already here, which then keeps it below the option for the person to send.
  const [dropping, setDropping] = useState(false);
  // Finder files and folders dropped on the composer become attachments (ADR-073): the native
  // window drop reports where it is; on a drop inside this composer its paths are attached.
  const dropAllowed = canType && !submitting;
  const primary = useAppStore((state) => session ? state.selectedSessionId === session.id : true);
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useEffect(() => {
    let alive = true;
    const inside = (x?: number, y?: number) => {
      const rect = boundary.current?.getBoundingClientRect();
      return Boolean(rect && x !== undefined && y !== undefined && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    };
    // Like T3 Code, a drop anywhere on the window lands in the active conversation's composer;
    // dropping on a particular composer (split view) picks that one.
    const overAnyComposer = (x?: number, y?: number) => x !== undefined && y !== undefined && [...document.querySelectorAll(".agent-composer")].some((node) => {
      const rect = node.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
    const isTarget = (x?: number, y?: number) => inside(x, y) || (!overAnyComposer(x, y) && primaryRef.current);
    const unlisten = client.onFileDrop((event) => {
      if (!alive) return;
      if (event.kind !== "drop") { setDropping(event.kind === "over" && dropAllowed && isTarget(event.x, event.y)); return; }
      setDropping(false);
      if (!dropAllowed || !isTarget(event.x, event.y)) return;
      const owner = draftKey;
      setAttachmentError(null);
      void client.dropPromptAttachments(owner).then(async (attachments) => {
        if (!attachments.length) return;
        const state = useAppStore.getState();
        const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
        try { state.setComposerContext(owner, { ...current, attachments: appendAttachments(current.attachments, attachments) }); }
        catch (error) { await client.releasePromptAttachments(owner, attachments.map((file) => file.id)); throw error; }
      }).catch((error: unknown) => setAttachmentError(formatUnknownError(error)));
    });
    return () => { alive = false; void unlisten.then((stop) => stop()); };
  }, [draftKey, dropAllowed]);
  const quickReply = useRef<string | null>(null);
  const sessionId = session?.id ?? null;
  useEffect(() => {
    const onQuickReply = (event: Event) => {
      const { sessionId: target, text, planning } = (event as CustomEvent<QuickReplyDetail>).detail;
      if (!sessionId || target !== sessionId) return;
      const state = useAppStore.getState();
      if (planning === false) setContext(draftKey, composerPlanning(composerContextForOwner(draftKey, state.composerContexts, state.sessions), false));
      const draft = state.composerDrafts[draftKey] ?? "";
      if (text !== null && !draft.trim()) { quickReply.current = text; updateDraft(draftKey, text); return; }
      if (text !== null) updateDraft(draftKey, `${text}\n\n${draft}`);
      requestAnimationFrame(() => area.current?.focus());
    };
    window.addEventListener(QUICK_REPLY_EVENT, onQuickReply);
    return () => window.removeEventListener(QUICK_REPLY_EVENT, onQuickReply);
  }, [sessionId, draftKey, updateDraft, setContext]);

  // ↑/↓ on an empty composer walk this session's sent prompts (T3-style recall).
  const recall = useRef<Recall>({ index: null, draft: "" });
  const recallPrompt = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!sessionId || event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return false;
    const direction = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!direction || (recall.current.index === null && (direction === 1 || value !== ""))) return false;
    const sent: string[] = [];
    for (const message of useAppStore.getState().sessions.find((row) => row.id === sessionId)?.messages ?? []) {
      const request = message.role === "user" ? splitPromptContext(message.content).request.trim() : "";
      if (request && sent.at(-1) !== request) sent.push(request);
    }
    const step = recallStep(sent, recall.current, value, direction);
    if (!step) return false;
    event.preventDefault();
    recall.current = step.state;
    setValue(step.value);
    const node = event.currentTarget;
    requestAnimationFrame(() => node.setSelectionRange(step.value.length, step.value.length));
    return true;
  };

  // ⌘S sets the draft aside (T3's stash); with an empty composer it brings one back.
  const [stash, setStash] = useState<string[]>(() => readStash(draftKey));
  const [stashOpen, setStashOpen] = useState(false);
  const [stashOwner, setStashOwner] = useState(draftKey);
  if (stashOwner !== draftKey) { setStashOwner(draftKey); setStash(readStash(draftKey)); setStashOpen(false); }
  const saveStash = (next: string[]) => { setStash(next); writeStash(draftKey, next); };
  const restoreStash = (index: number) => {
    const next = stash.filter((_, at) => at !== index);
    if (value.trim()) next.unshift(value.trim());
    saveStash(next);
    setValue(stash[index]);
    setStashOpen(false);
    requestAnimationFrame(() => area.current?.focus());
  };
  const stashKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || event.shiftKey || event.altKey) return false;
    event.preventDefault();
    if (value.trim()) { saveStash([value.trim(), ...stash]); setValue(""); recall.current = { index: null, draft: "" }; }
    else if (stash.length === 1) restoreStash(0);
    else if (stash.length) setStashOpen(true);
    return true;
  };

  // A finished planning turn offers Implement (also ⌘↩ on an empty composer).
  const planPending = useAppStore((state) => {
    const row = sessionId ? state.sessions.find((item) => item.id === sessionId) : null;
    if (!row?.execution?.planning || ["starting", "running", "waiting"].includes(row.status)) return false;
    const last = row.messages[row.messages.length - 1];
    return last?.role === "agent" && !last.streaming && Boolean(last.content.trim());
  });
  const implementPlan = () => { if (sessionId) window.dispatchEvent(new CustomEvent<QuickReplyDetail>(QUICK_REPLY_EVENT, { detail: { sessionId, text: t("plan.implementPrompt"), planning: false } })); };
  useEffect(() => {
    if (quickReply.current !== null && value === quickReply.current) { quickReply.current = null; void send(); }
  });

  const appendDictation = useCallback((text: string, sendAfter: boolean) => {
    const current = useAppStore.getState().composerDrafts[draftKey] ?? "";
    updateDraft(draftKey, `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`);
    // Sent once the draft and the dictation state have settled (see the effect below).
    sendAfterDictation.current = sendAfter;
    requestAnimationFrame(() => area.current?.focus());
  }, [draftKey, updateDraft]);
  const sendAfterDictation = useRef(false);
  useEffect(() => {
    if (!sendAfterDictation.current || dictating || !canSend) return;
    sendAfterDictation.current = false;
    void send();
  });

  return (
    <>
    {session && commandPanel === "status" ? <ComposerStatusCard session={session} effort={execution.effort} fast={execution.fast} approval={approvalLabel} planning={context.planning} onClose={() => { setCommandPanel(null); area.current?.focus(); }} /> : null}
    <AnimatePresence initial={false}>
      {session && commandPanel === "mcp" ? <motion.div key="mcp" initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={{ duration: reducedMotion ? 0 : motionTokens.fast }}>
        <ComposerMcpCard session={session} onClose={() => { setCommandPanel(null); area.current?.focus(); }} />
      </motion.div> : null}
    </AnimatePresence>
    {session ? <RenameSessionDialog session={session} open={commandPanel === "rename"} onClose={() => setCommandPanel(null)} /> : null}
    {session?.scripts?.runs?.length ? <ScriptRunNotice session={session} /> : null}
    {session?.usageLimit ? <UsageLimitNotice session={session} /> : null}
    {session ? <ComposerPromptQueue key={session.id} sessionId={session.id} /> : null}
    <Popover open={suggestions.visible} onOpenChange={(open) => { if (!open) suggestions.dismiss(); }}>
    <PopoverAnchor asChild>
    <div ref={boundary} data-dictating={dictating} className="agent-composer relative isolate mx-auto w-full max-w-[var(--chat-column-width)] rounded-[var(--composer-radius)] border border-[color-mix(in_oklab,var(--text-primary)_10%,transparent)] bg-[color-mix(in_oklab,var(--text-primary)_3%,transparent)] backdrop-blur-[8px] transition-colors duration-[var(--motion-fast)] focus-within:border-[color-mix(in_oklab,var(--text-primary)_20%,transparent)]" data-dropping={dropping || undefined}>
      {/* One animated rim at a time: the side chat's composer keeps a still border. */}
      {session?.sideChat ? null : <ComposerContour speed={settings.composerLineSpeed} reducedMotion={reducedMotion || dictating} />}
      {dropping ? <div className="composer-drop" aria-hidden="true">{t("composer.dropHere")}</div> : null}
      {dropping && primary ? createPortal(<div className="window-drop" aria-hidden="true"><span>{t("composer.dropHere")}</span></div>, document.body) : null}
      {session ? <HandoffCard session={session} /> : null}
      {planPending ? <div className="plan-banner"><ClipboardList size={14} aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t("plan.ready")}</span><button type="button" className="plan-banner-action" onClick={implementPlan}>{t("plan.implement")}<kbd>⌘↩</kbd></button></div> : null}
      <ComposerContextChips owner={draftKey} context={context} disabled={submitting} onChange={changeContext} planningAvailable={planningAvailable} />
      {attachmentError ? <p role="alert" className="pb-0 pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-2 ui-description text-danger">{t(attachmentError)}</p> : null}
      <div className="composer-editor relative">
      {highlighted ? <div ref={mirror} aria-hidden="true" className="composer-highlight pointer-events-none absolute inset-0 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words pb-[var(--composer-editor-padding-bottom)] pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-[var(--composer-editor-padding-top)] ui-chat text-text-primary">
        {composerSegments(value).map((segment, index) => segment.kind === "text" ? segment.text : <span key={index} className={`composer-token composer-token-${segment.kind}`}>{segment.text}</span>)}{"\n"}
      </div> : null}
      <Textarea
        label={t("session.prompt")}
        hideLabel
        variant="plain"
        ref={area}
        data-draft-owner={draftKey}
        value={value}
        disabled={!canType || pasting}
        placeholder={astroName ? t("astros.composer", { name: astroName }) : t("session.prompt")}
        aria-label={t("session.prompt")}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={suggestions.visible ? suggestions.listId : undefined}
        aria-activedescendant={suggestions.visible && suggestions.rows.length ? `${suggestions.listId}-${suggestions.index}` : undefined}
        rows={1}
        onChange={(event) => { recall.current = { index: null, draft: "" }; setValue(event.target.value); suggestions.syncCursor(event.currentTarget); }}
        onSelect={(event) => suggestions.syncCursor(event.currentTarget)}
        onFocus={(event) => suggestions.onFocus(event.currentTarget)}
        onBlur={suggestions.onBlur}
        onCompositionStart={suggestions.onCompositionStart}
        onCompositionEnd={(event) => suggestions.onCompositionEnd(event.currentTarget)}
        onPaste={(event) => {
          if (!canType || submitting || pastingRef.current) { if (pastingRef.current) event.preventDefault(); return; }
          const files = Array.from(event.clipboardData.files);
          const text = event.clipboardData.getData("text/plain");
          if (!files.length && text && !isAttachmentPaste(text)) return;
          event.preventDefault();
          const owner = draftKey;
          const start = event.currentTarget.selectionStart;
          const end = event.currentTarget.selectionEnd;
          const original = event.currentTarget.value;
          pastingRef.current = true;
          setPasting(true); setAttachmentError(null);
          void (async () => {
            try {
              const attachments = await client.pastePromptAttachments(owner, await pastedFiles(files), text || undefined);
              const state = useAppStore.getState();
              if (attachments.length) {
                const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
                try { state.setComposerContext(owner, { ...current, attachments: appendAttachments(current.attachments, attachments) }); }
                catch (error) { await client.releasePromptAttachments(owner, attachments.map((file) => file.id)); throw error; }
              } else if (text) {
                // A nonexistent path is still valid text. Preserve the captured draft owner.
                if ((state.composerDrafts[owner] ?? "") === original) state.setComposerDraft(owner, original.slice(0, start) + text + original.slice(end));
              }
            } catch (error) { setAttachmentError(formatUnknownError(error)); }
            finally { pastingRef.current = false; setPasting(false); }
          })();
        }}
        onKeyDown={(event) => {
          if (suggestions.onKeyDown(event)) return;
          if (stashKey(event) || recallPrompt(event)) return;
          if (!event.nativeEvent.isComposing && shortcutMatches(event, sendNewCombo)) { event.preventDefault(); void sendAndStartNew(); return; }
          if (planPending && event.key === "Enter" && (event.metaKey || event.ctrlKey) && !value.trim()) { event.preventDefault(); implementPlan(); return; }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(event.metaKey || event.ctrlKey);
          }
        }}
        className={`selectable scroll-thin max-h-[200px] min-h-[var(--composer-editor-min-height)] w-full resize-none overflow-y-auto bg-transparent pb-[var(--composer-editor-padding-bottom)] pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-[var(--composer-editor-padding-top)] ui-chat text-text-primary placeholder:text-text-muted disabled:opacity-50${highlighted ? " composer-input-highlighted" : ""}`}
        onScroll={(event) => { if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop; }}
      />
      </div>
      <div className="composer-footer flex items-center justify-between gap-1.5 pb-[var(--composer-footer-padding)] pl-[var(--composer-footer-padding)] pr-[var(--composer-footer-padding-end)]">
        <div className="composer-footer-context flex min-w-0 items-center gap-1">
          <ComposerAddMenu key={draftKey} boundaryRef={boundary} owner={draftKey} disabled={submitting || pasting || !canType} context={context} onChange={changeContext} planningAvailable={planningAvailable} teamAvailable={teamAvailable} />
          {stash.length ? <ComposerStash items={stash} open={stashOpen} onOpenChange={setStashOpen} onRestore={restoreStash} onRemove={(index) => saveStash(stash.filter((_, at) => at !== index))} /> : null}
          <div className="composer-idle-control">
          <Dropdown onOpenChange={(open) => { if (open) setApprovalLayout(composerPopoverLayout(approvalTrigger.current, boundary.current)); }}>
            <DropdownTrigger asChild>
              <button ref={approvalTrigger} type="button" disabled={submitting} aria-label={`${t("composer.approvals")} · ${approvalLabel}`} className={`composer-approval-trigger composer-control titlebar-no-drag inline-flex items-center gap-1.5 rounded-full px-2 ui-control transition-colors duration-[var(--motion-fast)] hover:bg-background-3 disabled:opacity-50 ${fullAccess ? "text-[var(--brand-claude)]" : "text-text-secondary"}`}>
                {fullAccess ? <ShieldAlert size={16} /> : approval === "auto" ? <Shield size={16} /> : <Hand size={16} />}{t(approvalLabel)}<ChevronDown size={11} />
              </button>
            </DropdownTrigger>
            <DropdownContent side="top" sideOffset={approvalLayout.sideOffset} alignOffset={approvalLayout.alignOffset} align="start" style={{ width: approvalLayout.width, maxWidth: "calc(100vw - 20px)" }} className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto p-2">
              <p className="px-2 pb-1 pt-1 ui-caption text-text-muted">{t("composer.approvalHint")}</p>
              {(["ask", "auto", "full"] as const).map((mode) => {
                const Icon = mode === "ask" ? Hand : mode === "auto" ? Shield : ShieldAlert;
                const label = mode === "ask" ? "composer.askApproval" : mode === "auto" ? "composer.autoReview" : "composer.fullAccess";
                const supported = definition.approvalModes.includes(mode);
                const description = !supported ? "composer.approvalUnsupported" : mode === "ask" ? "composer.askApprovalDescription" : mode === "auto" && agentId === "opencode" ? "composer.autoEditsDescription" : mode === "auto" ? "composer.autoReviewDescription" : "composer.fullAccessDescription";
                return <DropdownItem key={mode} disabled={!supported || submitting} onSelect={() => changeContext({ ...context, planning: mode === "full" ? false : context.planning, approvalByProvider: { ...context.approvalByProvider, [agentId]: mode } })} className={`py-2 ui-control [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-2.5 ${mode === "full" ? "text-[var(--brand-claude)]" : ""}`}>
                  <Icon aria-hidden="true" size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1"><span className="block ui-control">{t(label)}</span><span className={`block ui-description ${mode === "full" ? "opacity-80" : "text-text-muted"}`}>{t(description)}</span></span>
                  {supported && approval === mode ? <Check aria-hidden="true" size={13} className="shrink-0" /> : <span className="size-[13px] shrink-0" />}
                </DropdownItem>;
              })}
            </DropdownContent>
          </Dropdown>
          </div>
        </div>
        <div className="composer-footer-actions flex items-center gap-2">
          <div className="composer-idle-control composer-model-controls items-center gap-2">
          <ContextMeter session={session} />
          <ModelSelector executionControls switchOwner={session?.id ?? "landing"} disabled={running || sending || queueSending} currentProvider={agentId} currentModel={modelId} onSelect={(provider, model) => onModelChange?.(provider, model)} />
          </div>
          <ComposerDictationButton key={draftKey} onText={appendDictation} onActiveChange={setDictating} disabled={!canType || submitting || pasting} />
          <div className="composer-idle-control flex items-center gap-2">
          <AnimatePresence initial={false}>
            {running ? (
              <Tooltip label={t("Stop agent")}>
                <motion.button
                  key="stop"
                  type="button"
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : motionTokens.fast }}
                  whileTap={reducedMotion ? undefined : { scale: pressScale }}
                  aria-label={t("Stop agent")}
                  onClick={onStop}
                  className="composer-control composer-icon-control flex items-center justify-center rounded-full bg-text-primary text-background-0"
                >
                  <Square size={10} fill="currentColor" />
                </motion.button>
              </Tooltip>
            ) : null}
            {compactFirst ? (
              <Tooltip key="skip-compact" label={t("composer.sendWithoutCompact")}>
                <motion.button
                  key="skip-compact"
                  type="button"
                  disabled={!canSend}
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : motionTokens.fast }}
                  aria-label={t("composer.sendWithoutCompact")}
                  onClick={() => void send(false, true)}
                  className="composer-control composer-icon-control flex items-center justify-center rounded-full text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-background-3 disabled:opacity-50"
                >
                  <ArrowUp size={15} aria-hidden="true" />
                </motion.button>
              </Tooltip>
            ) : null}
            {compactFirst ? (
              <Tooltip key="compact-send" label={t("composer.compactSendHint")} shortcut="⏎">
                <motion.button
                  key="compact-send"
                  type="button"
                  disabled={!canSend}
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : motionTokens.fast }}
                  whileTap={canSend && !reducedMotion ? { scale: pressScale } : undefined}
                  aria-label={t("composer.compactSend")}
                  onClick={(event) => void send(false, event.shiftKey)}
                  className={cn(
                    "composer-compact-send composer-control inline-flex items-center gap-1.5 rounded-full px-3 ui-control transition-colors duration-[var(--motion-fast)]",
                    canSend ? "bg-text-primary text-background-0" : "bg-background-3 text-text-muted",
                  )}
                >
                  <Minimize2 size={14} aria-hidden="true" />{t("composer.compactSend")}
                </motion.button>
              </Tooltip>
            ) : !queueing || value.trim().length > 0 ? (
              <Tooltip label={t(queueing ? "queue.add" : "Send")} shortcut="⏎" secondary={{ label: t("composer.sendNewThread"), shortcut: shortcutLabel(sendNewCombo) }}>
                <motion.button
                  key="send"
                  type="button"
                  disabled={!canSend}
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0 : motionTokens.fast }}
                  whileTap={canSend && !reducedMotion ? { scale: pressScale } : undefined}
                  aria-label={t(queueing ? "queue.add" : "Send")}
                  onClick={() => void send()}
                  className={cn(
                    "composer-control composer-icon-control flex items-center justify-center rounded-full transition-colors duration-[var(--motion-fast)]",
                    canSend ? "bg-text-primary text-background-0" : "bg-background-3 text-text-muted",
                  )}
                >
                  {queueing ? <ListPlus size={16} aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
                </motion.button>
              </Tooltip>
            ) : null}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
    </PopoverAnchor>
    <ComposerSuggestions suggestions={suggestions} area={area} />
    </Popover>
    </>
  );
}

/** Memoized: streamed output re-renders the transcript, not this control. */
export const AgentComposer = memo(AgentComposerView);
