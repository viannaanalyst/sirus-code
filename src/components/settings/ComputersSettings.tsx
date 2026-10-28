import { useState } from "react";
import { Laptop, Server } from "@/components/icons";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { normalizePairingCode } from "@/client/remote-pairing";
import { useTranslation } from "@/i18n/use-translation";
import { computerStatus } from "@/lib/computers";
import { HOME_ENVIRONMENT, type Environment } from "@/lib/environments";
import { formatUnknownError } from "@/lib/format-error";
import { ConfirmDialog } from "@/primitives/ConfirmDialog";
import { InteractiveButton } from "@/primitives/InteractiveButton";
import { ComputerError, computerLabel, useComputers } from "@/store/computers-store";
import { SettingsGroup, SettingsRow } from "./SettingsSection";

/**
 * Settings → Connections → Computers (ADR-133): this Mac and the Sirus hosts this window works
 * on. A host is added with its address and the six-digit code from `sirus-host pair`.
 */
export function ComputersSettings() {
  const t = useTranslation();
  const computers = useComputers((state) => state.computers);
  const activeId = useComputers((state) => state.activeId);
  const connection = useComputers((state) => state.connection);
  useComputers((state) => state.hostInfo);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Environment | null>(null);
  const [forgetting, setForgetting] = useState<Environment | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const digits = normalizePairingCode(code);
    if (!digits || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useComputers.getState().addComputer(address, digits);
      setAdding(false);
      setAddress("");
      setCode("");
    } catch (reason) {
      setError(reason instanceof ComputerError ? t(reason.key) : formatUnknownError(reason));
    } finally { setBusy(false); }
  };
  const use = (id: string) => { void useComputers.getState().activate(id); };

  return <SettingsGroup title={t("computers.title")} card>
    <p className="settings-row ui-description text-text-muted">{t("computers.help")}</p>
    {computers.map((computer) => {
      const status = computerStatus(computer.id, activeId, connection[computer.id]);
      const label = computerLabel(computer.id);
      const Icon = computer.id === HOME_ENVIRONMENT || computer.kind === "mac" ? Laptop : Server;
      const statusText = t(status === "active" ? "computers.inUse" : `computers.${status}`);
      return <SettingsRow key={computer.id} title={computer.id === HOME_ENVIRONMENT ? `${label} · ${t("computers.thisMac")}` : label}
        description={[statusText, computer.id === HOME_ENVIRONMENT ? null : computer.baseUrl.replace(/^https:\/\//, "")].filter(Boolean).join(" · ")}>
        <Icon size={15} aria-hidden="true" className="text-text-muted" />
        {status !== "active" && status !== "unpaired" ? <InteractiveButton variant="toolbar" disabled={status === "offline" || status === "connecting"} onClick={() => use(computer.id)}>{t("computers.use")}</InteractiveButton> : null}
        {status === "unpaired" ? <InteractiveButton variant="toolbar" onClick={() => { setAddress(computer.baseUrl); setCode(""); setError(null); setAdding(true); }}>{t("computers.unpaired")}</InteractiveButton> : null}
        <InteractiveButton variant="toolbar" onClick={() => { setName(computer.label); setRenaming(computer); }}>{t("computers.rename")}</InteractiveButton>
        {computer.id !== HOME_ENVIRONMENT ? <InteractiveButton variant="toolbar" className="text-danger hover:text-danger" onClick={() => setForgetting(computer)}>{t("computers.forget")}</InteractiveButton> : null}
      </SettingsRow>;
    })}
    <SettingsRow title={t("computers.add")} description={t("computers.addHelp")}>
      <InteractiveButton variant="secondary" glow={false} onClick={() => { setAddress(""); setCode(""); setError(null); setAdding(true); }}>{t("computers.add")}</InteractiveButton>
    </SettingsRow>

    <Dialog open={adding} onOpenChange={(open) => { if (!open && !busy) setAdding(false); }}>
      <DialogContent title={t("computers.add")} description={t("computers.addHelp")} className="w-[min(440px,calc(100vw-32px))]">
        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <Input label={t("environments.address")} placeholder="https://sirus-vps.tailnet.ts.net" autoFocus required value={address} disabled={busy} onChange={(event) => setAddress(event.target.value)} />
          <Input label={t("environments.code")} inputMode="numeric" autoComplete="one-time-code" required maxLength={7} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} />
          {error ? <p role="alert" className="ui-caption text-danger">{error}</p> : null}
          <div className="mt-2 flex justify-end gap-2">
            <InteractiveButton variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t("common.cancel")}</InteractiveButton>
            <InteractiveButton type="submit" variant="secondary" loading={busy} disabled={!address.trim() || !normalizePairingCode(code)}>{t("environments.pair")}</InteractiveButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
      <DialogContent title={t("computers.rename")} className="w-[min(380px,calc(100vw-32px))]">
        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (renaming) useComputers.getState().rename(renaming.id, name); setRenaming(null); }}>
          <Input label={t("environments.name")} autoFocus maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
          <div className="mt-2 flex justify-end gap-2">
            <InteractiveButton variant="ghost" onClick={() => setRenaming(null)}>{t("common.cancel")}</InteractiveButton>
            <InteractiveButton type="submit" variant="secondary">{t("common.save")}</InteractiveButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog open={forgetting !== null} onOpenChange={(open) => { if (!open) setForgetting(null); }}
      title={`${t("computers.forget")} · ${forgetting ? computerLabel(forgetting.id) : ""}`}
      description={t("computers.forgetHelp", { name: forgetting ? computerLabel(forgetting.id) : "" })}
      confirmLabel={t("computers.forget")} cancelLabel={t("common.cancel")}
      onConfirm={() => { if (forgetting) void useComputers.getState().forget(forgetting.id); setForgetting(null); }} />
  </SettingsGroup>;
}
