import { memo, useState, type FormEvent } from "react";
import type { AgentResponse, PendingRequest, Session } from "@/client/types";
import { useAppStore } from "@/store/app-store";
import { useTranslation } from "@/i18n/use-translation";
import { MessageCircle, MousePointerClick, ShieldCheck } from "@/components/icons/phosphor";
import type { ComputerRequest } from "@/client/types";
import "@/styles/computer.css";
import { providerById } from "@/lib/provider-registry";
import { canAnswer } from "@/lib/agent-activity";
import { InteractiveButton } from "@/primitives/InteractiveButton";

function RequestCard({ sessionId, provider, request }: { sessionId: string; provider: string; request: PendingRequest }) {
  const t = useTranslation();
  const respond = useAppStore((state) => state.respondAgentRequest);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  const questions = request.kind.type === "userInput" ? request.kind.questions : [];
  const currentQuestion = questions[step];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const send = async (response: AgentResponse) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await respond({ sessionId, requestId: request.requestId, generation: request.generation, turnId: request.turnId, response });
    if (!ok) { setBusy(false); setFailed(true); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!currentQuestion || !canAnswer(currentQuestion, answers[currentQuestion.id])) return;
    if (step < questions.length - 1) { setStep(step + 1); return; }
    if (questions.some((question) => !canAnswer(question, answers[question.id]))) return;
    void send({ type: "userInput", answers: Object.fromEntries(questions.map((question) => [question.id, [answers[question.id]]])) });
  };
  const errorId = `request-error-${request.requestId}`;
  return <section aria-label={`${provider}: ${t("Your response is needed")}`} aria-busy={busy} className="agent-request mx-auto w-full max-w-[var(--chat-column-width)] rounded-[10px] border border-border-default p-4 ui-control text-text-primary">
    <div className="agent-request-eyebrow ui-caption">{request.kind.type === "userInput" ? <MessageCircle size={13} aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}<span>{provider} · {t(request.kind.type === "userInput" ? "Your response is needed" : "Approval requested")}</span>{questions.length ? <><span className="agent-question-progress" aria-hidden="true">{questions.map((question, index) => <span key={question.id} data-current={index === step} />)}</span><span className="tabular-nums">{step + 1}/{questions.length}</span></> : null}</div>
    {request.kind.type === "userInput" ? <form onSubmit={submit} className="flex flex-col gap-3">
      {currentQuestion ? <fieldset key={currentQuestion.id} disabled={busy}>
        <legend className="mb-1 ui-section">{currentQuestion.question}</legend>
        <p className="ui-caption text-text-muted">{currentQuestion.header}</p>
        <div className="agent-question-choices">{currentQuestion.options?.map((option) => <label key={option.label} className="agent-question-choice">
          <input type="radio" name={`${request.requestId}-${currentQuestion.id}`} value={option.label} checked={answers[currentQuestion.id] === option.label} onChange={() => setAnswers((current) => ({ ...current, [currentQuestion.id]: option.label }))} />
          <span>{option.label}<span className="mt-0.5 block ui-caption text-text-muted">{option.description}</span></span>
        </label>)}</div>
        {!currentQuestion.options || currentQuestion.isOther ? <label className="block ui-caption text-text-secondary">{t("Your answer")}
          <input type="text" maxLength={8192} value={answers[currentQuestion.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))} aria-describedby={failed ? errorId : undefined} className="mt-1 w-full rounded-[7px] border border-border-default bg-background-2 px-3 py-2 ui-control text-text-primary focus-visible:outline-2 focus-visible:outline-accent" />
        </label> : null}
      </fieldset> : null}
      <div className="flex items-center justify-between gap-2">
        <InteractiveButton type="button" variant="ghost" disabled={busy || step === 0} onClick={() => setStep(step - 1)}>{t("Back")}</InteractiveButton>
        <InteractiveButton type="submit" variant="primary" loading={busy} disabled={busy || !currentQuestion || !canAnswer(currentQuestion, answers[currentQuestion.id])}>{t(step < questions.length - 1 ? "Continue" : "Send answer")}</InteractiveButton>
      </div>
    </form> : <>
      {request.kind.reason ? <p className="mb-2 whitespace-pre-wrap text-text-secondary">{request.kind.reason}</p> : null}
      {request.kind.type === "command" ? <><pre className="scroll-thin mb-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-[7px] bg-background-2 p-2 font-mono ui-control">{request.kind.command}</pre>{request.kind.cwd ? <p className="mb-2 break-all text-text-muted">{request.kind.cwd}</p> : null}</> : request.kind.type === "tool" ? <div className="mb-2"><p className="mb-1 font-medium">{request.kind.name}</p><pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap rounded-[7px] bg-background-2 p-2 font-mono ui-control">{JSON.stringify(request.kind.input, null, 2)}</pre></div> : <div className="mb-2 text-text-secondary"><p>{t("Allow this file change?")}</p>{request.kind.changes.map((change, index) => <div key={`${change.path}:${index}`} className="mt-2"><p className="break-all font-mono ui-control">{change.kind}: {change.path}{change.movePath ? ` → ${change.movePath}` : ""}</p><pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap bg-background-2 p-2 font-mono ui-caption">{change.diff}</pre></div>)}</div>}
      <p className="mb-3 text-text-muted">{t("Applies only to this request. Review the action before allowing it.")}</p>
      <div className="flex gap-2">
        <InteractiveButton variant="primary" loading={busy} disabled={busy} onClick={() => void send({ type: "approval", decision: "accept" })}>{t("Allow once")}</InteractiveButton>
        <InteractiveButton disabled={busy} onClick={() => void send({ type: "approval", decision: "decline" })}>{t("Decline")}</InteractiveButton>
        <InteractiveButton variant="ghost" disabled={busy} onClick={() => void send({ type: "approval", decision: "cancel" })}>{t("Cancel turn")}</InteractiveButton>
      </div>
    </>}
    {failed ? <p id={errorId} role="alert" className="mt-2 text-danger">{t("Response could not be sent. Check the session status and stop the turn if needed.")}</p> : null}
  </section>;
}

/** App-owned computer-use approval: one app, this session only. */
function ComputerRequestCard({ request }: { request: ComputerRequest }) {
  const t = useTranslation();
  const act = useAppStore((state) => state.computerAction);
  const [busy, setBusy] = useState(false);
  const answer = async (allow: boolean) => { if (busy) return; setBusy(true); if (!await act({ type: "respond", requestId: request.id, allow })) setBusy(false); };
  return <div className="computer-request" role="group" aria-label={t("computer.requestTitle", { provider: request.provider, app: request.app })}>
    <span className="computer-request-icon" aria-hidden="true"><MousePointerClick size={16} /></span>
    <div className="min-w-0 flex-1">
      <p className="ui-control font-medium text-text-primary">{t("computer.requestTitle", { provider: request.provider, app: request.app })}</p>
      <p className="mt-0.5 ui-description text-text-muted">{t("computer.requestBody")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <InteractiveButton variant="primary" disabled={busy} onClick={() => void answer(true)}>{t("computer.allowSession")}</InteractiveButton>
        <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void answer(false)}>{t("computer.deny")}</InteractiveButton>
      </div>
    </div>
  </div>;
}

function AgentRequestsView({ session }: { session: Session }) {
  const computer = useAppStore((state) => state.computer?.requests);
  const computerRequests = computer?.filter((request) => request.sessionId === session.id) ?? [];
  return session.pendingRequests?.length || computerRequests.length ? <div className="scroll-thin max-h-[40vh] overflow-y-auto px-6 py-3" aria-live="polite">
    {computerRequests.map((request) => <ComputerRequestCard key={request.id} request={request} />)}
    {session.pendingRequests?.map((request) => <RequestCard key={`${session.id}:${request.generation}:${request.requestId}`} sessionId={session.id} provider={providerById(session.agent).name} request={request} />)}
  </div> : null;
}

/** Memoized: streamed output re-renders the transcript, not this control. */
export const AgentRequests = memo(AgentRequestsView);
