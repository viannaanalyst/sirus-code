import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Copy, Download } from "lucide-react";
import { client } from "@/client";
import type { LocalProfile, ProfileImageAction } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { useTranslation } from "@/i18n/use-translation";
import { useAppStore } from "@/store/app-store";
import { renderProfileCard, type ProfileCardImage } from "@/lib/profile-image";
import type { ProfileStats } from "@/lib/profile-stats";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import xMark from "@/assets/social/x.svg";
import linkedinMark from "@/assets/social/linkedin.svg";
import redditMark from "@/assets/social/reddit.svg";

export function ShareProfileDialog({ open, onOpenChange, profile, defaultName, stats }: { open: boolean; onOpenChange: (open: boolean) => void; profile: LocalProfile; defaultName: string; stats: ProfileStats }) {
  const t = useTranslation();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent title={t("Share your activity")} description={t("Copy or save your card. Social buttons open a composer so you can paste the image.")} className="profile-share-dialog">
    <ProfileShareContent profile={profile} defaultName={defaultName} stats={stats} />
  </DialogContent></Dialog>;
}
export function ProfileShareContent({ profile, defaultName, stats }: { profile: LocalProfile; defaultName: string; stats: ProfileStats }) {
  const t = useTranslation(), currentLocale = useAppStore(state => state.settings.locale);
  const [snapshot] = useState(() => ({ profile, defaultName, stats, locale: currentLocale }));
  const [image, setImage] = useState<ProfileCardImage | null>(null), [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null), [busy, setBusy] = useState<ProfileImageAction | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void renderProfileCard(snapshot.profile, snapshot.defaultName, snapshot.stats, snapshot.locale).then(next => { if (!cancelled) setImage(next); }).catch(cause => { if (!cancelled) setError(t(cause instanceof Error ? cause.message : "Could not prepare the image.")); });
    return () => { cancelled = true; };
  }, [snapshot, retry, t]);
  const act = async (action: ProfileImageAction) => {
    if (!image || busy) return;
    setBusy(action); setError(null); setStatus(null);
    try {
      const result = await client.profileImageAction(image.data, action);
      setStatus(t(result === "composerOpened" ? "Image copied. Paste it into your post." : result === "saved" ? "Activity image saved." : result === "cancelled" ? "Save cancelled." : "Image copied to clipboard."));
    } catch (cause) { setError(t(cause instanceof Error ? cause.message : "Could not export activity image.")); }
    finally { setBusy(null); }
  };
  const actions: { action: ProfileImageAction; label: string; icon: ReactNode }[] = [
    { action: "copy", label: t("Copy"), icon: <Copy size={22} aria-hidden="true" /> },
    { action: "x", label: "X", icon: <img src={xMark} alt="" /> },
    { action: "linkedin", label: "LinkedIn", icon: <img src={linkedinMark} alt="" /> },
    { action: "reddit", label: "Reddit", icon: <img src={redditMark} alt="" /> },
    { action: "save", label: t("Save"), icon: <Download size={23} aria-hidden="true" /> },
  ];
  return <div className="profile-share-body">
    <div className="profile-share-preview" aria-busy={!image && !error}>
      {image ? <img src={image.dataUrl} alt={t("Your Switchyard activity card")} /> : <div className="profile-card-placeholder ui-description">{t(error ? "Could not prepare the image." : "Preparing your card…")}</div>}
    </div>
    <div className="profile-share-actions">{actions.map(({ action, label, icon }) => <div key={action}>
      <button type="button" className="profile-share-action" aria-label={action === "copy" ? t("Copy activity image") : action === "save" ? t("Save activity image") : t("Share activity on {network}", { network: label })} disabled={!image || !!busy} onClick={() => void act(action)}>{icon}</button>
      <span className="ui-control text-text-muted">{label}</span>
    </div>)}</div>
    <p className="profile-share-status ui-description text-text-muted" role="status">{busy ? t("Preparing image action…") : status ?? ""}</p>
    {error ? <div className="profile-share-error"><p className="ui-description text-status-error" role="alert">{error}</p>{!image ? <InteractiveButton variant="secondary" glow={false} onClick={() => { setError(null); setRetry(value => value + 1); }}>{t("Try again")}</InteractiveButton> : null}</div> : null}
  </div>;
}
