import { useEffect, useState } from "react";
import { Plus, Trash2 } from "@/components/icons/phosphor";
import type { AppSettings, BrowserProfile } from "@/client/types";
import { client } from "@/client";
import { useTranslation } from "@/i18n/use-translation";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { SettingsGroup, SettingsRow } from "./SettingsSection";

const MAX_PROFILES = 10;
const NAME_LIMIT = 40;
const BUILT_IN = ["default", "private"];

/** Browser profiles (ADR-150): named cookie stores for browser tabs, and the default for new tabs. */
export function BrowserProfilesSettings({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  const t = useTranslation();
  const [supported, setSupported] = useState(true);
  const [draft, setDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<BrowserProfile | null>(null);
  const profiles = settings.browserProfiles ?? [];

  useEffect(() => {
    void client.browserProfilesSupported().then(setSupported, () => setSupported(false));
  }, []);

  /** Empty, too long, a built-in name, or already used by another profile. */
  const nameProblem = (name: string, exceptId?: string) => {
    const trimmed = name.trim();
    const folded = trimmed.toLowerCase();
    return !trimmed || trimmed.length > NAME_LIMIT || BUILT_IN.includes(folded)
      || profiles.some((profile) => profile.id !== exceptId && profile.name.toLowerCase() === folded);
  };

  const add = () => {
    if (nameProblem(draft) || profiles.length >= MAX_PROFILES) return;
    const profile: BrowserProfile = { id: crypto.randomUUID(), name: draft.trim() };
    onSave({ ...settings, browserProfiles: [...profiles, profile] });
    setDraft("");
  };

  const rename = (profile: BrowserProfile, name: string) => {
    if (name.trim() === profile.name || nameProblem(name, profile.id)) return;
    onSave({ ...settings, browserProfiles: profiles.map((item) => (item.id === profile.id ? { ...item, name: name.trim() } : item)) });
  };

  const remove = async (profile: BrowserProfile) => {
    // The data goes first: if that fails, the profile stays listed.
    await client.browserProfileDelete(profile.id);
    onSave({
      ...settings,
      browserProfiles: profiles.filter((item) => item.id !== profile.id),
      defaultBrowserProfile: settings.defaultBrowserProfile === profile.id ? "default" : settings.defaultBrowserProfile,
    });
  };

  const choices = [
    { value: "default", label: t("browser.profileDefault") },
    { value: "private", label: t("browser.profilePrivate") },
    ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
  ];
  const defaultChoice = choices.some((choice) => choice.value === settings.defaultBrowserProfile) ? settings.defaultBrowserProfile : "default";
  const addDisabled = !supported || profiles.length >= MAX_PROFILES || nameProblem(draft);

  return <SettingsGroup title={t("browser.profiles")} card>
    <p className="px-0 pb-2 ui-description text-text-muted">{t("browser.profilesHelp")}</p>
    <SettingsRow title={t("browser.profileDefault")}>
      <span className="ui-caption text-text-muted">{t("browser.profileBuiltIn")}</span>
    </SettingsRow>
    <SettingsRow title={t("browser.profilePrivate")} description={t("browser.profilePrivateHelp")}>
      <span className="ui-caption text-text-muted">{t("browser.profileBuiltIn")}</span>
    </SettingsRow>
    {profiles.map((profile) => <SettingsRow key={profile.id} title={profile.name}>
      <div className="flex items-center gap-2">
        <input key={profile.name} defaultValue={profile.name} aria-label={t("browser.profileRename")} maxLength={NAME_LIMIT}
          onBlur={(event) => rename(profile, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          className="h-8 w-[180px] rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 ui-control text-text-primary outline-none focus:border-border-default" />
        <InteractiveButton variant="secondary" glow={false} aria-label={t("browser.profileDelete")} onClick={() => setPendingDelete(profile)}>
          <Trash2 size={14} aria-hidden="true" />{t("browser.profileDelete")}
        </InteractiveButton>
      </div>
    </SettingsRow>)}
    <SettingsRow title={t("browser.profileAdd")} description={!supported ? t("browser.profileNeedsMacOS") : profiles.length >= MAX_PROFILES ? t("browser.profileLimit") : undefined}>
      <div className="flex items-center gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("browser.profileNamePlaceholder")} aria-label={t("browser.profileNamePlaceholder")} maxLength={NAME_LIMIT} disabled={!supported}
          onKeyDown={(event) => { if (event.key === "Enter" && !addDisabled) add(); }}
          className="h-8 w-[180px] rounded-[var(--radius-md)] border border-border-subtle bg-background-1 px-2.5 ui-control text-text-primary outline-none placeholder:text-text-muted focus:border-border-default disabled:opacity-50" />
        <InteractiveButton variant="secondary" glow={false} disabled={addDisabled} onClick={add}>
          <Plus size={14} aria-hidden="true" />{t("browser.profileAdd")}
        </InteractiveButton>
      </div>
    </SettingsRow>
    <SettingsRow title={t("browser.profileDefaultForTabs")} description={t("browser.profileDefaultForTabsHelp")}>
      <SegmentedControl label={t("browser.profileDefaultForTabs")} value={defaultChoice} options={choices}
        onChange={(defaultBrowserProfile) => onSave({ ...settings, defaultBrowserProfile })} />
    </SettingsRow>
    <ConfirmDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      title={t("browser.profileDeleteTitle", { name: pendingDelete?.name ?? "" })} description={t("browser.profileDeleteHelp")}
      confirmLabel={t("browser.profileDelete")} cancelLabel={t("browser.dialogCancel")}
      onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)} />
  </SettingsGroup>;
}
