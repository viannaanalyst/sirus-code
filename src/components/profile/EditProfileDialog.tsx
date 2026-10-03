import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { LocalProfile, ProfileAvatarColor } from "@/client/types";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { useTranslation } from "@/i18n/use-translation";
import { normalizeProfile, PROFILE_COLORS, profileIdentity } from "@/lib/profile-stats";
import { compressProfileAvatar } from "@/lib/profile-image";
import { useAppStore } from "@/store/app-store";
import { ProfileAvatar } from "./ProfileAvatar";

export function EditProfileDialog({ open, onOpenChange, profile, defaultName }: { open: boolean; onOpenChange: (open: boolean) => void; profile: LocalProfile; defaultName: string }) {
  const t = useTranslation();
  const [busy, setBusy] = useState(false);
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}><DialogContent title={t("Edit profile")} description={t("Your profile stays on this device.")} className="profile-edit-dialog">
    <EditProfileContent profile={profile} defaultName={defaultName} onClose={() => onOpenChange(false)} busy={busy} onBusyChange={setBusy} />
  </DialogContent></Dialog>;
}
export function EditProfileContent({ profile, defaultName, onClose, busy = false, onBusyChange = () => {} }: { profile: LocalProfile; defaultName: string; onClose: () => void; busy?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const t = useTranslation();
  const identity = profileIdentity(profile, defaultName);
  const [draft, setDraft] = useState({ ...profile, name: identity.name, handle: identity.handle.slice(1) });
  const [error, setError] = useState<string | null>(null);
  const preview = normalizeProfile(draft);
  const pick = async (file: File | undefined) => {
    if (!file || busy) return;
    onBusyChange(true); setError(null);
    try { const avatarImage = await compressProfileAvatar(file); setDraft(current => ({ ...current, avatarImage })); }
    catch (cause) { setError(t(cause instanceof Error ? cause.message : "Could not prepare the image.")); }
    finally { onBusyChange(false); }
  };
  const save = async () => {
    if (busy) return;
    const next = normalizeProfile(draft);
    if (!next.name) { setError(t("Enter a display name.")); return; }
    onBusyChange(true); setError(null);
    await useAppStore.getState().saveSettings({ ...useAppStore.getState().settings, profile: next });
    if (JSON.stringify(useAppStore.getState().settings.profile) === JSON.stringify(next)) onClose();
    else setError(t("Could not save your profile. Try again."));
    onBusyChange(false);
  };
  return <form className="profile-edit-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="profile-avatar-editor">
      <ProfileAvatar profile={preview} initials={profileIdentity(preview, defaultName).initials} large />
      <div className="flex items-center gap-2">
        <label className="profile-photo-picker ui-control" aria-disabled={busy}><ImagePlus size={14} aria-hidden="true" />{t("Choose photo")}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label={t("Choose photo")} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void pick(file); }} />
        </label>
        {draft.avatarImage ? <InteractiveButton variant="toolbar" glow={false} disabled={busy} aria-label={t("Remove photo")} onClick={() => setDraft(current => ({ ...current, avatarImage: null }))}><Trash2 size={14} aria-hidden="true" /></InteractiveButton> : null}
      </div>
      <fieldset className="profile-color-picker" disabled={busy}><legend className="sr-only">{t("Avatar color")}</legend>
        {(Object.keys(PROFILE_COLORS) as ProfileAvatarColor[]).map(color => <label key={color} style={{ backgroundColor: PROFILE_COLORS[color] }}><input type="radio" name="avatarColor" value={color} checked={draft.avatarColor === color} onChange={() => setDraft(current => ({ ...current, avatarColor: color }))} aria-label={t(`Avatar ${color}`)} /><span aria-hidden="true" /></label>)}
      </fieldset>
    </div>
    <Input label={t("Display name")} value={draft.name} disabled={busy} maxLength={160} autoComplete="off" onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
    <Input label={t("Username")} value={draft.handle} disabled={busy} maxLength={32} autoComplete="off" spellCheck={false} description={t("Letters, numbers, dots, underscores and hyphens.")} onChange={event => setDraft(current => ({ ...current, handle: event.target.value }))} />
    {error ? <p role="alert" className="ui-description text-status-error">{error}</p> : null}
    <div className="profile-dialog-actions"><InteractiveButton variant="secondary" glow={false} disabled={busy} onClick={onClose}>{t("Cancel")}</InteractiveButton><InteractiveButton type="submit" glow={false} disabled={busy}>{t(busy ? "Saving…" : "Save")}</InteractiveButton></div>
  </form>;
}
