import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock3 as Clock, Copy, Globe, Laptop, RefreshCw, Smartphone } from "@/components/icons/phosphor";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import type { RemoteDevice, RemotePairing } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";
import { formatUnknownError } from "@/lib/format-error";
import { pairingCountdown } from "@/lib/remote-connections";
import { PairingQrCode } from "@/components/PairingQrCode";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";

type Way = "app" | "browser";

const SUGGESTIONS = ["connections.suggest.personal", "connections.suggest.work", "connections.suggest.ipad"] as const;

/**
 * "Connect a device" (ADR-080): an illustration of what happens on the other device, a switch
 * between the iPhone app and a browser, and one view per state: a live code (QR with the Sirus
 * mark, the six digits, steps), the device that just joined (named right away), and an expired
 * code. A new code replaces the old one; the countdown, copy and new-code controls sit below.
 */
export function PairDeviceDialog({ open, onOpenChange, url, joined, clearJoined, newCode, rename }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** This Mac's address on the tailnet. */
  url: string;
  /** The device that paired while the dialog was open. */
  joined: RemoteDevice | null;
  /** Forgets `joined`, to pair one more device. */
  clearJoined: () => void;
  newCode: () => Promise<RemotePairing>;
  rename: (deviceId: string, name: string) => Promise<void>;
}) {
  const t = useTranslation();
  const [way, setWay] = useState<Way>("app");
  const [pairing, setPairing] = useState<RemotePairing | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const asked = useRef(false);

  const fresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    // The old code leaves the screen before the new one is asked for, so a failure never shows a dead code.
    setPairing(null);
    try { setPairing(await newCode()); setNow(Date.now()); } catch (reason) { setError(formatUnknownError(reason)); } finally { setBusy(false); }
  }, [newCode]);

  useEffect(() => {
    if (!open) { asked.current = false; return; }
    if (asked.current) return;
    asked.current = true;
    void fresh();
  }, [open, fresh]);
  useEffect(() => { if (joined) setName(joined.name); }, [joined]);
  useEffect(() => {
    if (!open || !pairing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, pairing]);

  const countdown = pairing ? pairingCountdown(pairing.expiresAt, now) : null;
  const view = joined ? "linked" : pairing && !countdown ? "expired" : "live";
  const code = pairing?.code ?? "······";
  // With a public route the app tab shows the `sirus://pair` link, which a scan opens in the iPhone app (ADR-155).
  const appLink = pairing?.appUrl ?? pairing?.urls[0] ?? "";
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); });
  /** Saves the name typed for the device that joined; false when it could not. */
  const saveName = async () => {
    if (!joined || !name.trim() || name.trim() === joined.name) return true;
    setBusy(true);
    try { await rename(joined.id, name.trim()); return true; } catch (reason) { setError(formatUnknownError(reason)); return false; } finally { setBusy(false); }
  };
  const finish = async () => { if (await saveName()) onOpenChange(false); };

  const hero = <div className="pair-hero" data-tone={view === "expired" ? "warm" : undefined} aria-hidden="true">
    {view === "live" && way === "app" ? <div className="pair-hero-phone">
      <span className="pair-hero-island" />
      <span className="pair-hero-app"><i /></span>
      <b>{t("connections.hero.ask")}</b>
      <small>{t("connections.hero.askHelp")}</small>
      <span className="pair-hero-pill">{t("connections.hero.connect")}</span>
    </div> : null}
    {view === "live" && way === "browser" ? <div className="pair-hero-browser">
      <div className="pair-hero-bar"><i /><i /><i /><span>{url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span></div>
      <div className="pair-hero-digits"><b>{t("connections.hero.typeCode")}</b><div>{code.split("").map((digit, index) => <span key={index}>{digit}</span>)}</div></div>
    </div> : null}
    {view !== "live" ? <div className="pair-hero-linked">
      <span className="pair-hero-tile"><Smartphone size={26} /></span>
      <span className="pair-hero-dots"><i /><b data-off={view === "expired" || undefined}>{view === "expired" ? <Clock size={14} /> : <Check size={14} />}</b><i /></span>
      <span className="pair-hero-tile"><Laptop size={26} /></span>
    </div> : null}
  </div>;

  const title = view === "linked" ? t("connections.linked", { name: joined?.name ?? "" }) : view === "expired" ? t("connections.expiredTitle") : t("connections.connect");
  const description = view === "linked" ? t("connections.nameHelp") : view === "expired" ? t("connections.expiredHelp") : way === "app" ? t("connections.appHelp") : t("connections.browserHelp");

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent title={title} description={description} hero={hero} variant="plain" className="pair-dialog w-[min(520px,calc(100vw-32px))]"
      // The dialog itself takes focus on open, so the close button does not wear a focus ring; the name field still focuses itself.
      onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus(); }}>
      {view === "live" ? <div className="pair-body">
        <SegmentedControl<Way> value={way} onChange={setWay} label={t("connections.way")} options={[
          { value: "app", label: t("connections.way.app"), content: <span className="pair-way"><Smartphone size={13} aria-hidden="true" />{t("connections.way.app")}</span> },
          { value: "browser", label: t("connections.way.browser"), content: <span className="pair-way"><Globe size={13} aria-hidden="true" />{t("connections.way.browser")}</span> },
        ]} />
        {way === "app" ? <div className="pair-card pair-card-qr">
          {pairing ? <PairingQrCode value={appLink} label={t("connections.qrLabel")} size={168} /> : <div className="pair-qr-placeholder" aria-hidden="true" />}
          <div className="pair-side">
            <div><small>{t("connections.orType")}</small><p className="pair-code" aria-label={t("connections.codeLabel", { code })}>{code.slice(0, 3)}&thinsp;{code.slice(3)}</p></div>
            <ol className="pair-steps"><li>{t(pairing?.appUrl ? "connections.step.anywhere" : "connections.step.tailscale")}</li><li>{t("connections.step.scan")}</li><li>{t("connections.step.name")}</li></ol>
          </div>
        </div> : <div className="pair-card">
          <div className="pair-address"><small>{t("connections.address")}</small><code>{url}</code>
            <InteractiveButton variant="toolbar" aria-label={t("connections.copy")} onClick={() => copy(url)}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}</InteractiveButton></div>
          <div className="pair-bigcode" aria-label={t("connections.codeLabel", { code })}>{code.split("").map((digit, index) => <span key={index} data-gap={index === 3 || undefined}>{digit}</span>)}</div>
          <p className="pair-note">{t("connections.browserNote")}</p>
        </div>}
        {error ? <p role="alert" className="ui-caption text-danger">{error}</p> : null}
        <div className="pair-foot">
          <span className="pair-timer" aria-live="polite"><Clock size={13} aria-hidden="true" />{countdown ? t("connections.expiresIn", { time: countdown }) : busy ? t("connections.making") : ""}</span>
          <span className="pair-actions">
            {way === "app" && pairing ? <InteractiveButton variant="secondary" glow={false} onClick={() => copy(appLink)}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{t("connections.copyLink")}</InteractiveButton> : null}
            <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => void fresh()}><RefreshCw size={14} aria-hidden="true" />{t("connections.newCode")}</InteractiveButton>
          </span>
        </div>
      </div> : null}
      {view === "linked" ? <div className="pair-body pair-center">
        <label className="pair-name"><span>{t("connections.name")}</span>
          <input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void finish(); }} /></label>
        <div className="pair-suggestions">{SUGGESTIONS.map((key) => <button key={key} type="button" onClick={() => setName(t(key))}>{t(key)}</button>)}</div>
        {error ? <p role="alert" className="ui-caption text-danger">{error}</p> : null}
        <div className="pair-actions">
          <InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={() => { void saveName().then((ok) => { if (ok) { clearJoined(); void fresh(); } }); }}>{t("connections.another")}</InteractiveButton>
          <InteractiveButton variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void finish()}>{t("connections.done")}</InteractiveButton>
        </div>
      </div> : null}
      {view === "expired" ? <div className="pair-body pair-center">
        <div className="pair-actions">
          <InteractiveButton variant="secondary" glow={false} onClick={() => onOpenChange(false)}>{t("common.close")}</InteractiveButton>
          <InteractiveButton variant="primary" disabled={busy} onClick={() => void fresh()}><RefreshCw size={14} aria-hidden="true" />{t("connections.newCode")}</InteractiveButton>
        </div>
      </div> : null}
    </DialogContent>
  </Dialog>;
}
