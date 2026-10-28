import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { REMOTE_TOKEN_KEY, deviceName } from "@/client/remote-pairing";
import { disablePush, enablePush, pushEnabled, pushSupport, sharePushWith, unsharePushWith } from "@/client/remote-push";
import { Bell, Bot, Box, Bug, ChevronLeft, Code, FileText, Folder, Gauge, GitBranch, Info, Keyboard, MessageSquarePlus, Palette, Rows, Shield, Smartphone, TerminalSquare, Wrench, X } from "@/components/icons";
import { usePhoneTranslation as useTranslation } from "./use-phone-host";
import { HOME_ENVIRONMENT } from "@/lib/environments";
import { useEnvironments } from "@/store/environments-store";
import { EnvironmentRows, useEnvironmentLabel } from "./MobileEnvironments";
import { formatUnknownError } from "@/lib/format-error";
import { motionTokens } from "@/lib/motion";
import { PHONE_MONO_SIZES, PHONE_TEXT_SIZES, usePhonePrefs, type PhonePrefs } from "@/lib/phone-prefs";
import { useMotionPreferences } from "@/lib/use-motion-preferences";
import { Switch } from "@/primitives/Switch";
import { useAppStore } from "@/store/app-store";
import type { MobileNavigation } from "./MobileApp";
import { APP_VERSION, ClientStoragePage, DiagnosticsPage, LegalPage, LicensesPage, type AboutPage as AboutSubpage } from "./MobileAboutPages";
import { MobileMacSettings, type MacSettingsPage } from "./MobileMacSettings";
import { Choices, Row } from "./MobileSettingsParts";
import { MobileUsage } from "./MobileUsage";
import "@/styles/mobile-settings.css";

type Page = "notifications" | "appearance" | "keyboard" | "organization" | "usage" | "about" | MacSettingsPage | AboutSubpage;
type Translate = ReturnType<typeof useTranslation>;
const MAC_PAGES: readonly MacSettingsPage[] = ["newConversations", "sourceControl", "agentBehavior", "maintenance"];

/**
 * Settings as a sheet from the home's top corner: grouped rows,
 * each opening its own page inside the sheet (About opens its own pages one level deeper).
 * Appearance, keyboard and organization stay on this phone (`phone-prefs`); the "Mac settings"
 * pages change the Mac's own settings through `saveSettings` (ADR-130).
 */
export function MobileSettings({ online, navigation }: { online: boolean; navigation: MobileNavigation }) {
  const t = useTranslation();
  const reduced = useMotionPreferences();
  const [stack, setStack] = useState<Page[]>([]);
  // Which way the last move went, so a page slides in from the right and back out to it.
  const [forward, setForward] = useState(true);
  const page = stack.at(-1) ?? null;
  const open = (next: Page) => { setForward(true); setStack((pages) => [...pages, next]); };
  const back = () => { setForward(false); setStack((pages) => pages.slice(0, -1)); };
  const titles: Record<Page, string> = {
    notifications: t("mobile.alerts"),
    appearance: t("mobile.appearance"),
    keyboard: t("mobile.keyboard"),
    organization: t("mobile.organization"),
    usage: t("mobile.usage"),
    about: t("mobile.about"),
    newConversations: t("phoneSettings.newConversations"),
    sourceControl: t("phoneSettings.sourceControl"),
    agentBehavior: t("settings.agentBehavior"),
    maintenance: t("phoneSettings.maintenance"),
    clientStorage: t("phoneSettings.clientStorage"),
    diagnostics: t("phoneSettings.diagnostics"),
    licenses: t("phoneSettings.licenses"),
    legal: t("phoneSettings.legal"),
  };
  const slide = { duration: reduced ? 0 : motionTokens.normal, ease: motionTokens.ease };
  return <div className="mobile-page mobile-sheet">
    <span className="mobile-sheet-grip" aria-hidden="true" />
    <header className="mobile-sheet-head">
      {page ? <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.back")} onClick={back}><ChevronLeft size={17} aria-hidden="true" /></button> : <span />}
      <h1>{page ? titles[page] : t("mobile.settings")}</h1>
      {page ? <span /> : <button type="button" className="mobile-sheet-close mobile-glass" aria-label={t("mobile.cancel")} onClick={navigation.back}><X size={17} aria-hidden="true" /></button>}
    </header>
    <div className="mobile-settings-pages">
      <AnimatePresence initial={false} mode="popLayout" custom={forward}>
        <motion.div key={stack.join("/") || "root"} className="mobile-scroll mobile-form mobile-settings-page" custom={forward}
          variants={{ enter: (ahead: boolean) => ({ x: ahead ? "100%" : "-30%", opacity: ahead ? 1 : 0 }), center: { x: 0, opacity: 1 }, exit: (ahead: boolean) => ({ x: ahead ? "-30%" : "100%", opacity: ahead ? 0 : 1 }) }}
          initial="enter" animate="center" exit="exit" transition={slide}>
          {page === null ? <SettingsIndex online={online} open={open} /> : null}
          {page === "notifications" ? <AlertsSection /> : null}
          {page === "appearance" ? <AppearancePage /> : null}
          {page === "keyboard" ? <KeyboardPage /> : null}
          {page === "organization" ? <OrganizationPage /> : null}
          {page === "usage" ? <MobileUsage /> : null}
          {page === "about" ? <AboutPage open={open} /> : null}
          {page && (MAC_PAGES as readonly Page[]).includes(page) ? <MobileMacSettings page={page as MacSettingsPage} online={online} /> : null}
          {page === "clientStorage" ? <ClientStoragePage /> : null}
          {page === "diagnostics" ? <DiagnosticsPage online={online} /> : null}
          {page === "licenses" ? <LicensesPage /> : null}
          {page === "legal" ? <LegalPage /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  </div>;
}

function SettingsIndex({ online, open }: { online: boolean; open: (page: Page) => void }) {
  const t = useTranslation();
  return <>
    <section>
      <h2>{t("mobile.connections")}</h2>
      <div className="mobile-card">
        {/* Every computer this phone talks to, and "Add computer" (ADR-132). A server is named by its host name, never "Mac" (ADR-131). */}
        <EnvironmentRows />
        <Row icon={<Bell size={19} />} label={t("mobile.alerts")} onClick={() => open("notifications")} />
        <Row icon={<Smartphone size={19} />} label={t("mobile.thisDevice")} value={deviceName(navigator.userAgent)} />
      </div>
    </section>
    <section>
      <h2>{t("mobile.interface")}</h2>
      <div className="mobile-card">
        <Row icon={<Palette size={19} />} label={t("mobile.appearance")} onClick={() => open("appearance")} />
        <Row icon={<Keyboard size={19} />} label={t("mobile.keyboard")} onClick={() => open("keyboard")} />
      </div>
    </section>
    <section>
      <h2>{t("mobile.projectsAndConversations")}</h2>
      <div className="mobile-card">
        <Row icon={<Folder size={19} />} label={t("mobile.organization")} onClick={() => open("organization")} />
      </div>
      <p className="mobile-help">{t("mobile.settingsHere")}</p>
    </section>
    <section>
      <h2>{t("phoneSettings.macSettings")}</h2>
      <div className="mobile-card">
        <Row icon={<MessageSquarePlus size={19} />} label={t("phoneSettings.newConversations")} onClick={() => open("newConversations")} />
        <Row icon={<GitBranch size={19} />} label={t("phoneSettings.sourceControl")} onClick={() => open("sourceControl")} />
        <Row icon={<Bot size={19} />} label={t("settings.agentBehavior")} onClick={() => open("agentBehavior")} />
        <Row icon={<Wrench size={19} />} label={t("phoneSettings.maintenance")} onClick={() => open("maintenance")} />
      </div>
      <p className="mobile-help">{t(online ? "phoneSettings.macHelp" : "phoneSettings.offline")}</p>
    </section>
    <section>
      <h2>{t("mobile.app")}</h2>
      <div className="mobile-card">
        <Row icon={<Gauge size={19} />} label={t("mobile.usage")} onClick={() => open("usage")} />
        <Row icon={<Info size={19} />} label={t("mobile.about")} onClick={() => open("about")} />
      </div>
    </section>
  </>;
}

/** Alerts from the Mac (ADR-082): explains what is missing, or offers the switch. */
function AlertsSection() {
  const t = useTranslation();
  const support = pushSupport();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (support === "ready") void pushEnabled().then(setOn); }, [support]);
  const label = useEnvironmentLabel();
  const home = useEnvironments((state) => state.environments.filter((item) => item.token).length > 1 ? state.environments.find((item) => item.id === HOME_ENVIRONMENT) : undefined);
  const toggle = async (next: boolean) => {
    const token = window.localStorage.getItem(REMOTE_TOKEN_KEY);
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The other computers alert this app too (ADR-132 addendum).
      const others = useEnvironments.getState().environments.filter((item) => item.id !== HOME_ENVIRONMENT && item.token);
      if (next) {
        const enabled = await enablePush(token);
        setOn(enabled);
        if (enabled) for (const other of others) void sharePushWith(other.baseUrl, other.token);
      } else {
        await disablePush(token);
        setOn(false);
        for (const other of others) void unsharePushWith(other.baseUrl, other.token);
      }
    } catch (reason) {
      setError(formatUnknownError(reason));
    } finally {
      setBusy(false);
    }
  };
  return <section>
    <h2>{t("mobile.agentActivity")}</h2>
    <div className="mobile-card">
      <div className="mobile-setting">
        <span><span className="mobile-option-title">{t("mobile.alertsSwitch")}</span><br /><span className="mobile-option-help">{t("mobile.alertsKinds")}</span></span>
        <Switch checked={on} disabled={support !== "ready" || busy} onChange={(value) => void toggle(value)} label={t("mobile.alertsSwitch")} />
      </div>
    </div>
    {support !== "ready" ? <p className="mobile-help">{t(`mobile.alerts.${support}`)}</p> : null}
    {/* Each computer signs alerts with its own key; a home-screen app holds one subscription (ADR-132). */}
    {home ? <p className="mobile-help">{t("environments.alertsHome", { name: label(home) })}</p> : null}
    {error ? <p role="alert" className="mobile-help text-danger">{error}</p> : null}
  </section>;
}

function AppearancePage() {
  const t = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const prefs = usePhonePrefs((state) => state.prefs);
  const update = usePhonePrefs((state) => state.update);
  const theme = prefs.theme ?? settings.theme;
  const textSize = prefs.textSize ?? settings.uiFontSize;
  return <>
    <section>
      <h2>{t("mobile.colorScheme")}</h2>
      <div className="mobile-schemes" role="radiogroup" aria-label={t("mobile.colorScheme")}>
        {(["system", "light", "dark"] as const).map((id) => <button key={id} type="button" role="radio" aria-checked={theme === id} className="mobile-scheme" onClick={() => update({ theme: id })}>
          <span className="mobile-scheme-phone" data-scheme={id} aria-hidden="true"><span /><span /><span /></span>
          <span>{t(`mobile.scheme.${id}`)}</span>
        </button>)}
      </div>
    </section>
    <section>
      <h2>{t("mobile.text")}</h2>
      <div className="mobile-card">
        <div className="mobile-text-sample" style={{ fontSize: `${textSize + 2}px` }}>
          <p>{t("mobile.textSample")}</p>
          <span>{t("mobile.textSampleHelp")}</span>
        </div>
        <SizeSlider label={t("mobile.textSize")} value={textSize} range={PHONE_TEXT_SIZES} onChange={(value) => update({ textSize: value })} />
      </div>
    </section>
    <section>
      <h2>{t("mobile.terminal")}</h2>
      <div className="mobile-card">
        <pre className="mobile-mono-sample" style={{ fontSize: `${prefs.terminalFontSize ?? settings.terminalFontSize}px` }}>
          <span data-tone="accent">→ sirus git:(main)</span> npm run dev{"\n"}VITE ready in 1.2s{"\n"}<span data-tone="success">✓ 85 passed</span> <span data-tone="warning">△ 2 warnings</span>
        </pre>
        <MonoSize icon={<TerminalSquare size={19} />} prefs={prefs} field="terminalFontSize" fallback={settings.terminalFontSize} update={update} t={t} />
      </div>
    </section>
    <section>
      <h2>{t("mobile.codeAndDiffs")}</h2>
      <div className="mobile-card">
        <pre className="mobile-mono-sample" data-wrap={(prefs.wordWrap ?? settings.diffWordWrap) || undefined} style={{ fontSize: `${prefs.codeFontSize ?? settings.codeFontSize}px` }}>
          <span data-tone="accent">function</span> formatUser(user) {"{"}{"\n"}  <span data-tone="accent">return</span> `${"{"}user.name{"}"} &lt;${"{"}user.email{"}"}&gt;` <span data-tone="muted">// example</span>{"\n"}{"}"}
        </pre>
        <MonoSize icon={<Code size={19} />} prefs={prefs} field="codeFontSize" fallback={settings.codeFontSize} update={update} t={t} />
        <div className="mobile-settings-row">
          <span className="mobile-settings-icon" aria-hidden="true"><Rows size={19} /></span>
          <span className="mobile-settings-label">{t("mobile.wordWrap")}</span>
          <Switch checked={prefs.wordWrap ?? settings.diffWordWrap} onChange={(value) => update({ wordWrap: value })} label={t("mobile.wordWrap")} />
        </div>
      </div>
    </section>
  </>;
}

/** A font size the phone can set for itself: off follows the Mac, on shows the slider. */
function MonoSize({ icon, prefs, field, fallback, update, t }: { icon: ReactNode; prefs: PhonePrefs; field: "terminalFontSize" | "codeFontSize"; fallback: number; update: (patch: Partial<PhonePrefs>) => void; t: Translate }) {
  const custom = prefs[field] !== undefined;
  return <>
    <div className="mobile-settings-row">
      <span className="mobile-settings-icon" aria-hidden="true">{icon}</span>
      <span className="mobile-settings-label">{t("mobile.customFontSize")}</span>
      <Switch checked={custom} onChange={(value) => update({ [field]: value ? fallback : undefined })} label={t("mobile.customFontSize")} />
    </div>
    {custom ? <SizeSlider label={t("mobile.fontSize")} value={prefs[field] ?? fallback} range={PHONE_MONO_SIZES} onChange={(value) => update({ [field]: value })} /> : null}
  </>;
}

function SizeSlider({ label, value, range, onChange }: { label: string; value: number; range: { min: number; max: number }; onChange: (value: number) => void }) {
  return <label className="mobile-slider">
    <span className="mobile-slider-head"><span>{label}</span><span>{value} pt</span></span>
    <span className="mobile-slider-track">
      <span aria-hidden="true" className="mobile-slider-small">A</span>
      <input type="range" min={range.min} max={range.max} step={1} value={value} onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--fill": `${((value - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties} />
      <span aria-hidden="true" className="mobile-slider-large">A</span>
    </span>
  </label>;
}

function KeyboardPage() {
  const t = useTranslation();
  const returnKey = usePhonePrefs((state) => state.prefs.returnKey);
  const update = usePhonePrefs((state) => state.update);
  return <section>
    <h2>{t("mobile.returnKey")}</h2>
    <Choices label={t("mobile.returnKey")} value={returnKey} onChange={(value) => update({ returnKey: value })} options={[
      { id: "send", title: t("mobile.return.send"), help: t("mobile.return.sendHelp") },
      { id: "newline", title: t("mobile.return.newline"), help: t("mobile.return.newlineHelp") },
    ]} />
    <p className="mobile-help">{t("mobile.returnKeyHelp")}</p>
  </section>;
}

function OrganizationPage() {
  const t = useTranslation();
  const order = usePhonePrefs((state) => state.prefs.projectOrder);
  const update = usePhonePrefs((state) => state.update);
  return <section>
    <h2>{t("mobile.projectOrder")}</h2>
    <Choices label={t("mobile.projectOrder")} value={order} onChange={(value) => update({ projectOrder: value })} options={[
      { id: "recent", title: t("mobile.order.recent"), help: t("mobile.order.recentHelp") },
      { id: "name", title: t("mobile.order.name"), help: t("mobile.order.nameHelp") },
    ]} />
  </section>;
}

/** About Sirus: client storage, diagnostics, licenses, legal and the version. */
function AboutPage({ open }: { open: (page: Page) => void }) {
  const t = useTranslation();
  const host = useAppStore((state) => state.hostInfo);
  const disconnect = () => {
    window.localStorage.removeItem(REMOTE_TOKEN_KEY);
    window.location.replace("/");
  };
  return <>
    <section>
      <h2>{t("mobile.app")}</h2>
      <div className="mobile-card">
        <Row icon={<Box size={19} />} label={t("phoneSettings.clientStorage")} onClick={() => open("clientStorage")} />
        <Row icon={<Bug size={19} />} label={t("phoneSettings.diagnostics")} onClick={() => open("diagnostics")} />
        <Row icon={<FileText size={19} />} label={t("phoneSettings.licenses")} onClick={() => open("licenses")} />
        <Row icon={<Shield size={19} />} label={t("phoneSettings.legal")} onClick={() => open("legal")} />
        <Row icon={<Info size={19} />} label={t("phoneSettings.version")} value={APP_VERSION || "—"} />
      </div>
    </section>
    <section>
      <div className="mobile-card">
        {host?.shell ? <Row icon={<TerminalSquare size={19} />} label="Shell" value={host.shell} /> : null}
        <Row icon={<Smartphone size={19} />} label={t("mobile.thisDevice")} value={deviceName(navigator.userAgent)} />
      </div>
      <p className="mobile-help">{t("mobile.installHelp")}</p>
    </section>
    <section>
      <button type="button" className="mobile-danger" onClick={disconnect}>{t("mobile.disconnect")}</button>
      <p className="mobile-help">{t("mobile.disconnectHelp")}</p>
    </section>
  </>;
}
