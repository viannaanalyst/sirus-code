import { useRef, useState } from "react";
import { ChevronDown, ImagePlus, Paperclip, Plus } from "@/components/icons";
import { client } from "@/client";
import { ModelIcon } from "@/components/ModelIcon";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import type { PhoneAddMenuProps, PhoneComposerSlot, PhoneModelButtonProps } from "@/components/phone-composer-slot";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { appendAttachments } from "@/lib/composer-attachments";
import { composerContextForOwner } from "@/lib/composer-context";
import { formatUnknownError } from "@/lib/format-error";
import { modelDisplayName, readableModelId } from "@/lib/model-registry";
import { readPhoneFiles } from "@/lib/phone-attachments";
import { providerById } from "@/lib/provider-registry";
import { useAppStore } from "@/store/app-store";
import { MobilePopover } from "./MobilePopover";
import { MobileThreadSettings } from "./MobileThreadSettings";

/** The composer controls of the phone conversation (ADR-129); `onOverlay` keeps the card open while a menu or sheet shows. */
export function phoneComposerSlot(placeholder: string, onOverlay: (open: boolean) => void): PhoneComposerSlot {
  return {
    placeholder,
    addMenu: (props) => <PhoneAddMenu key={props.owner} {...props} onOverlay={onOverlay} />,
    modelButton: (props) => <PhoneModelButton {...props} onOverlay={onOverlay} />,
  };
}

/** "+": a small glass menu with Choose files and Photo library. */
function PhoneAddMenu({ owner, disabled, onOverlay }: PhoneAddMenuProps & { onOverlay: (open: boolean) => void }) {
  const t = useTranslation();
  const trigger = useRef<HTMLButtonElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const show = (next: boolean) => { setOpen(next); onOverlay(next); };
  const attach = async (chosen: File[]) => {
    if (!chosen.length || picking) return;
    setPicking(true);
    try {
      const attachments = await client.pastePromptAttachments(owner, await readPhoneFiles(chosen));
      if (!attachments.length) return;
      // The owner captured when the picker opened, even if the page changed meanwhile.
      const state = useAppStore.getState();
      const current = composerContextForOwner(owner, state.composerContexts, state.sessions);
      try { state.setComposerContext(owner, { ...current, attachments: appendAttachments(current.attachments, attachments) }); }
      catch (error) { await client.releasePromptAttachments(owner, attachments.map((file) => file.id)); throw error; }
    } catch (error) {
      useAppStore.setState({ error: formatUnknownError(error) });
    } finally {
      setPicking(false);
    }
  };
  const picked = (input: HTMLInputElement) => { const chosen = [...(input.files ?? [])]; input.value = ""; void attach(chosen); };
  return <>
    <button ref={trigger} type="button" disabled={disabled || picking} aria-label={t("composer.add")} aria-haspopup="menu" aria-expanded={open}
      className="phone-composer-add composer-control composer-icon-control inline-flex shrink-0 items-center justify-center rounded-full" onClick={() => show(true)}>
      <Plus size={18} aria-hidden="true" />
    </button>
    <input ref={files} type="file" multiple hidden accept="image/*,application/pdf,text/*,.md,.csv,.json,.docx,.xlsx" onChange={(event) => picked(event.currentTarget)} />
    <input ref={photos} type="file" multiple hidden accept="image/*" onChange={(event) => picked(event.currentTarget)} />
    <MobilePopover open={open} anchor={trigger.current} placement="above" width={230} label={t("composer.add")} onClose={() => show(false)} items={[
      { id: "files", title: t("phoneChat.chooseFiles"), icon: <Paperclip size={17} />, onSelect: () => files.current?.click() },
      { id: "photos", title: t("phoneChat.photoLibrary"), icon: <ImagePlus size={17} />, onSelect: () => photos.current?.click() },
    ]} />
  </>;
}

/** The provider icon and model name; a tap opens Thread settings. */
function PhoneModelButton(props: PhoneModelButtonProps & { onOverlay: (open: boolean) => void }) {
  const t = useTranslation();
  const { provider, model, onOverlay } = props;
  const catalogs = useAppStore((state) => state.modelsByProvider);
  const [open, setOpen] = useState(false);
  const raw = catalogs[provider]?.models.find((row) => row.id === model)?.displayName ?? (model ? readableModelId(model) : null);
  const label = raw ? modelDisplayName(provider, raw, catalogs[provider]?.models.map((row) => row.displayName)).replace(/^Claude\s+/i, "") : t("models.select");
  const show = (next: boolean) => { setOpen(next); onOverlay(next); };
  return <>
    <button type="button" className="phone-composer-model composer-control inline-flex min-w-0 items-center gap-1.5 rounded-full" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${t("phoneChat.threadSettings")} · ${label} · ${providerById(provider).name}`} onClick={() => show(true)}>
      {model ? <ModelIcon modelId={model} provider={provider} size={16} /> : <ProviderIcon id={provider} size={16} />}
      <span className="truncate">{label}</span>
      <ChevronDown size={12} aria-hidden="true" className="shrink-0" />
    </button>
    <MobileThreadSettings {...props} open={open} onClose={() => show(false)} />
  </>;
}
