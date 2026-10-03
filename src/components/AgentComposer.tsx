import { client } from "@/client";
import { appendAttachments, isAttachmentPaste, pastedFiles } from "@/lib/composer-attachments";
import { formatUnknownError } from "@/lib/format-error";
import { Textarea } from "@/components/arc/textarea/textarea";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { useTranslation } from "@/i18n/use-translation";
import { Check, ChevronDown, Hand, Shield, ShieldAlert, Square, ArrowUp, ListPlus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentInstall, AgentProviderId, ExecutionOptions, Session } from "@/client/types";
import { ComposerAddMenu, ComposerContextChips } from "@/components/ComposerAddMenu";
import { ComposerContour } from "@/components/ComposerContour";
import { ComposerSuggestions } from "@/components/ComposerSuggestions";
import { useComposerSuggestions } from "@/lib/use-composer-suggestions";
import { ComposerDictationButton } from "@/components/ComposerDictationButton";
import { ComposerPromptQueue } from "@/components/ComposerPromptQueue";
import { HandoffCard } from "@/components/HandoffCard";
import { modelExecutionControls, supportsPlanning } from "@/lib/execution-options";
import { ModelSelector } from "@/components/ModelSelector";
import { modelKey, parseModelKey } from "@/lib/settings";
import { providerById } from "@/lib/provider-registry";
import { cn } from "@/lib/cn";
import { composerPopoverLayout } from "@/lib/popover-position";
import { motionTokens, pressScale } from "@/lib/motion";
import { composerContextForOwner, composerPrompt, emptyComposerContext } from "@/lib/composer-context";
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

export function AgentComposer({ session, disabled, onSend, onStop, onModelChange }: Props) {
  const t = useTranslation();
  const reducedMotion = useMotionPreferences();
  const draftProjectId = useAppStore((state) => state.selectedProjectId);
  const draftKey = session ? `session:${session.id}` : `project:${draftProjectId}`;
  const value = useAppStore((state) => state.composerDrafts[draftKey] ?? "");
  const updateDraft = useAppStore((state) => state.setComposerDraft);
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
  const definition = providerById(agentId);
  const approvalPolicy = definition.approvalPolicy;
  const selectedApproval = context.approvalByProvider?.[agentId];
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
  const teamAvailable = ["codex", "claude", "opencode"].includes(agentId) && !session?.teamWorker
    && !(session?.team && ["planning", "proposed", "running", "ready"].includes(session.team.status));
  const submitting = (sending && !running) || queueSending;
  const canSend = (value.trim().length > 0 || context.attachments.length > 0) && !dictating && !submitting && !pasting && !modelChanging && canType && providerReady && (!context.planning || planningAvailable);
  const suggestions = useComposerSuggestions(draftKey, value, area, !canType || submitting || pasting || dictating || modelChanging);

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

  const send = async () => {
    const guard = queueing ? enqueueRef : sendingRef;
    if (!canSend || guard.current) return;
    guard.current = true;
    if (queueing) setQueueSending(true); else setSending(true);
    const submitted = value;
    const teamOwner = context.team ? draftKey : null;
    try {
      const sent = await onSend(composerPrompt(submitted, context), { effort: agentId === "cursor" && !execution.parameterized ? null : execution.effort, fast: agentId === "cursor" && !execution.parameterized ? false : execution.fast, planning: context.planning, approval: definition.approvalModes.length ? approval : null });
      // A team request is one-shot: the next message talks to the coordinator normally.
      if (sent && teamOwner) {
        const state = useAppStore.getState();
        const current = state.composerContexts[teamOwner];
        if (current?.team) state.setComposerContext(teamOwner, { ...current, team: false });
      }
    } finally {
      guard.current = false;
      if (queueing) setQueueSending(false); else setSending(false);
    }
  };

  const appendDictation = useCallback((text: string) => {
    const current = useAppStore.getState().composerDrafts[draftKey] ?? "";
    updateDraft(draftKey, `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`);
    requestAnimationFrame(() => area.current?.focus());
  }, [draftKey, updateDraft]);

  return (
    <>
    {session ? <ComposerPromptQueue key={session.id} sessionId={session.id} /> : null}
    <Popover open={suggestions.visible} onOpenChange={(open) => { if (!open) suggestions.dismiss(); }}>
    <PopoverAnchor asChild>
    <div ref={boundary} data-dictating={dictating} className="agent-composer relative isolate mx-auto w-full max-w-[var(--chat-column-width)] rounded-[var(--composer-radius)] border border-border-default bg-background-2 transition-colors duration-[var(--motion-fast)]">
      <ComposerContour speed={settings.composerLineSpeed} reducedMotion={reducedMotion || dictating} />
      {session ? <HandoffCard session={session} /> : null}
      <ComposerContextChips owner={draftKey} context={context} disabled={submitting} onChange={changeContext} planningAvailable={planningAvailable} />
      {attachmentError ? <p role="alert" className="pb-0 pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-2 ui-description text-danger">{t(attachmentError)}</p> : null}
      <Textarea
        label={t("session.prompt")}
        hideLabel
        variant="plain"
        ref={area}
        data-draft-owner={draftKey}
        value={value}
        disabled={!canType || pasting}
        placeholder={t("session.prompt")}
        aria-label={t("session.prompt")}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={suggestions.visible ? suggestions.listId : undefined}
        aria-activedescendant={suggestions.visible && suggestions.rows.length ? `${suggestions.listId}-${suggestions.index}` : undefined}
        rows={1}
        onChange={(event) => { setValue(event.target.value); suggestions.syncCursor(event.currentTarget); }}
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
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        className="selectable scroll-thin max-h-[200px] min-h-[var(--composer-editor-min-height)] w-full resize-none overflow-y-auto bg-transparent pb-[var(--composer-editor-padding-bottom)] pl-[var(--composer-editor-padding-x)] pr-[var(--composer-editor-padding-x-end)] pt-[var(--composer-editor-padding-top)] ui-chat text-text-primary placeholder:text-text-muted disabled:opacity-50"
      />
      <div className="composer-footer flex items-center justify-between gap-1.5 pb-[var(--composer-footer-padding)] pl-[var(--composer-footer-padding)] pr-[var(--composer-footer-padding-end)]">
        <div className="composer-footer-context flex min-w-0 items-center gap-1">
          <ComposerAddMenu key={draftKey} boundaryRef={boundary} owner={draftKey} disabled={submitting || pasting || !canType} context={context} onChange={changeContext} planningAvailable={planningAvailable} teamAvailable={teamAvailable} />
          <div className="composer-idle-control">
          <Dropdown onOpenChange={(open) => { if (open) setApprovalLayout(composerPopoverLayout(approvalTrigger.current, boundary.current)); }}>
            <DropdownTrigger asChild>
              <button ref={approvalTrigger} type="button" disabled={submitting} aria-label={`${t("composer.approvals")} · ${approvalLabel}`} className={`composer-control titlebar-no-drag inline-flex items-center gap-1.5 rounded-full px-2 ui-control transition-colors duration-[var(--motion-fast)] hover:bg-background-3 disabled:opacity-50 ${fullAccess ? "text-[var(--brand-claude)]" : "text-text-secondary"}`}>
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
          <ModelSelector executionControls disabled={running || sending || queueSending} currentProvider={agentId} currentModel={modelId} onSelect={(provider, model) => onModelChange?.(provider, model)} />
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
            {!queueing || value.trim().length > 0 ? (
              <Tooltip label={t(queueing ? "queue.add" : "Send")} shortcut="⏎">
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
