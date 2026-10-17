import { useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from "@react-navigation/native";
import * as Application from "expo-application";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import type { AppSettings, ProviderUsage, Session } from "@sirus/client/types";
import { translate } from "@sirus/i18n";
import { orderedUsageWindows, resetDuration, USAGE_PROVIDER_IDS, usageWindowLabel } from "@sirus/lib/provider-usage";
import { providerById } from "@sirus/lib/provider-registry";
import { APPROVAL_CHOICES, AUTO_ARCHIVE_DEFAULT_DAYS, AUTO_ARCHIVE_MAX_DAYS, clampArchiveDays, isProviderEnabled, STREAMING_CHOICES, WORKSPACE_CHOICES } from "@sirus/lib/settings";
import { isSnoozed, snoozeCountdown } from "@sirus/lib/snooze";

import type { AppSymbolName } from "../components/AppSymbol";
import { SymbolView } from "../components/AppSymbol";
import { AppText } from "../components/AppText";
import { ListChoiceRow } from "../components/ListChoiceRow";
import { ListRow } from "../components/ListRow";
import { ListRowLayout } from "../components/ListRowLayout";
import { ListSection } from "../components/ListSection";
import { ListToggleRow } from "../components/ListToggleRow";
import { ProviderIcon } from "../components/ProviderIcon";
import { computerName } from "../data/computers";
import { useSirus } from "../data/store";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";
import { CodeAppearanceSection } from "../features/settings/appearance/sections/CodeAppearanceSection";
import { TerminalAppearanceSection } from "../features/settings/appearance/sections/TerminalAppearanceSection";
import { TextAppearanceSection } from "../features/settings/appearance/sections/TextAppearanceSection";
import { ThemeAppearanceSection } from "../features/settings/appearance/sections/ThemeAppearanceSection";
import { createNativeMailSearchToolbarItem } from "../features/layout/native-mail-search-toolbar";
import { checkForAppUpdate, runningUpdateLabel } from "../data/app-updates";
import { ConnectScreen } from "./ConnectScreen";
import SIRUS_GLYPH from "../../assets/sirus-glyph.png";
import { useUniwindTheme } from "../lib/useUniwindTheme";

const t = (key: string, params?: Record<string, string | number>) => translate("pt-BR", key, params);
const icon = (name: string) => name as AppSymbolName;

/** The computer the Mac settings pages change, when there are several. */
const useSettingsComputer = create<{ id: string | null; set: (id: string) => void }>()((set) => ({ id: null, set: (id) => set({ id }) }));

/**
 * One settings page: the sheet's color, a scroll view under the glass header,
 * sections of grouped rows.
 */
function Page(props: { readonly title: string; readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View collapsable={false} className="flex-1 bg-screen">
    <NativeStackScreenOptions options={{ title: props.title }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} className="flex-1"
      contentContainerClassName="gap-5 px-5 pt-4" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}>
      {props.children}
    </ScrollView>
  </View>;
}

function Note(props: { readonly children: string }) {
  return <AppText className="-mt-2 px-2 text-sm text-foreground-muted">{props.children}</AppText>;
}

/**
 * Ajustes (ADR-135), the fourth tab: the Sirus card (this iPhone, its computers and the app
 * version) and the phone web app's sections, each row a white symbol on a coloured square as iOS
 * Settings draws them, opening its page over the tabs.
 */
export function SettingsScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const insets = useSafeAreaInsets();
  const theme = useUniwindTheme();
  const computers = useSirus((state) => state.computers);
  const connection = useSirus((state) => state.connection);
  const data = useSirus((state) => state.data);
  const prefs = useSirus((state) => state.prefs);
  const archived = useMemo(() => Object.values(data).reduce((sum, value) => sum + (value.settings?.archivedSessionIds.length ?? 0), 0), [data]);
  const snoozed = useMemo(() => Object.values(data).reduce((sum, value) => sum + value.sessions.filter((session) => !session.sideChat && isSnoozed(session)).length, 0), [data]);
  const online = computers.filter((computer) => connection[computer.id] === "open").length;
  const go = (screen: string) => () => navigation.navigate(screen);
  return <>
    <NativeStackScreenOptions options={{ title: t("mobile.settings"), headerTitle: undefined, headerSearchBarOptions: undefined, unstable_headerLeftItems: () => [], unstable_headerRightItems: () => [] }} />
    <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} className="flex-1 bg-screen"
      contentContainerClassName="gap-6 px-4 pt-3" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}>
      <Pressable onPress={go("SettingsAbout")} accessibilityRole="button" accessibilityLabel="Sobre o Sirus Code"
        className="flex-row items-center gap-3.5 rounded-[24px] border-continuous bg-grouped-card px-4 py-3.5 active:bg-row-hover">
        <View className="size-[54px] items-center justify-center rounded-[15px] border-continuous bg-foreground">
          <Image source={SIRUS_GLYPH} style={{ width: 32, height: 32, tintColor: theme["--color-screen"] }} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <AppText className="font-app-bold text-xl">Sirus Code</AppText>
          <AppText numberOfLines={1} className="text-sm text-foreground-muted">
            {computers.length === 1 ? computerName(computers[0]!) : `${computers.length} computadores`} · {online === computers.length ? "conectado" : `${online} de ${computers.length} conectado${online === 1 ? "" : "s"}`} · {Application.nativeApplicationVersion ?? ""}
          </AppText>
        </View>
        <SymbolView name="chevron.right" size={14} weight="semibold" tintColorClassName="accent-chevron" />
      </Pressable>
      <ListSection title={t("mobile.connections")}>
        <ListRow icon={icon("desktopcomputer")} tint="#4f8cff" label="Computadores" detail={String(computers.length)} onPress={go("SettingsComputers")} />
        <ListRow icon={icon("bell.badge.fill")} tint="#e5604d" label={t("mobile.alerts")} onPress={go("SettingsAlerts")} />
      </ListSection>
      <ListSection title={t("mobile.interface")}>
        <ListRow icon={icon("paintbrush.fill")} tint="#a16ae8" label={t("mobile.appearance")} detail={t(`mobile.scheme.${prefs.colorScheme}`)} onPress={go("SettingsAppearance")} />
        <ListRow icon={icon("keyboard.fill")} tint="#8e8e93" label={t("mobile.keyboard")} onPress={go("SettingsKeyboard")} />
      </ListSection>
      <ListSection title={t("mobile.projectsAndConversations")}>
        <ListRow icon={icon("folder.fill")} tint="#45b8ac" label={t("mobile.organization")} onPress={go("SettingsOrganization")} />
        <ListRow icon={icon("archivebox.fill")} tint="#ee8a3a" label={t("mobile.archivedConversations")} detail={String(archived)} onPress={go("SettingsArchived")} />
        <ListRow icon={icon("moon.fill")} tint="#5856d6" label="Conversas adiadas" detail={String(snoozed)} onPress={go("SettingsSnoozed")} />
      </ListSection>
      <ListSection title={t("phoneSettings.macSettings")} footer={t("mobile.settingsHere")}>
        <ListRow icon={icon("plus.bubble.fill")} tint="#30a46c" label={t("phoneSettings.newConversations")} onPress={go("SettingsNewConversations")} />
        <ListRow icon={icon("text.bubble.fill")} tint="#4f8cff" label={t("phoneSettings.conversationBehavior")} onPress={go("SettingsConversationBehavior")} />
        <ListRow icon={icon("arrow.triangle.branch")} tint="#e0609a" label={t("phoneSettings.sourceControl")} onPress={go("SettingsSourceControl")} />
        <ListRow icon={icon("sparkles")} tint="#f0a830" label="Comportamento do agente" onPress={go("SettingsAgentBehavior")} />
        <ListRow icon={icon("wrench.and.screwdriver.fill")} tint="#6e6e78" label={t("phoneSettings.maintenance")} onPress={go("SettingsMaintenance")} />
      </ListSection>
      <ListSection title={t("mobile.app")}>
        <ListRow icon={icon("chart.bar.fill")} tint="#30a46c" label={t("mobile.usage")} onPress={go("SettingsUsage")} />
        <ListRow icon={icon("info.circle.fill")} tint="#8e8e93" label={t("mobile.about")} onPress={go("SettingsAbout")} />
      </ListSection>
    </ScrollView>
  </>;
}

export function SettingsComputersScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const computers = useSirus((state) => state.computers);
  return <Page title="Computadores">
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Button accessibilityLabel="Conectar outro computador" icon="plus" onPress={() => navigation.navigate("SettingsAddComputer")} />
    </NativeHeaderToolbar>
    <ListSection>
      {computers.map((computer, index) => <ComputerRow key={computer.id} computerId={computer.id} separated={index > 0} onPress={() => navigation.navigate("SettingsComputer", { computerId: computer.id })} />)}
    </ListSection>
    <Note>Um Mac ou um servidor com o Sirus, alcançado pela sua rede Tailscale. As conversas de todos aparecem juntas no início.</Note>
  </Page>;
}

/** A computer row: status dot, kind, name; address and state below. */
function ComputerRow(props: { readonly computerId: string; readonly separated?: boolean; readonly onPress: () => void }) {
  const computer = useSirus((state) => state.computers.find((item) => item.id === props.computerId));
  const state = useSirus((store) => store.connection[props.computerId]);
  if (!computer) return null;
  const label = state === "open" ? "Conectado" : state === "lost" ? "Fora de alcance" : "Conectando…";
  return <Pressable onPress={props.onPress} className={`bg-grouped-card active:opacity-70 ${props.separated ? "border-t border-border-subtle" : ""}`}>
    <View className="flex-row items-center gap-3 px-4 py-3.5">
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <View className={`size-2 rounded-full ${state === "open" ? "bg-adaptive-emerald-600-400" : state === "lost" ? "bg-danger-foreground" : "bg-warning"}`} />
          <SymbolView name={(computer.kind === "server" ? "server.rack" : "laptopcomputer") as AppSymbolName} size={13} tintColorClassName="accent-foreground-muted" />
          <AppText numberOfLines={1} className="shrink font-app-bold text-base">{computerName(computer)}</AppText>
        </View>
        <AppText numberOfLines={1} className="text-sm text-foreground-muted">{computer.baseUrl}</AppText>
        <AppText className="text-sm text-foreground-muted">{label}</AppText>
      </View>
      <SymbolView name="chevron.right" size={14} weight="semibold" tintColorClassName="accent-chevron" />
    </View>
  </Pressable>;
}

/** One computer: its state, address and conversations, and forgetting it. */
export function SettingsComputerScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { computerId } = useRoute<RouteProp<{ SettingsComputer: { computerId: string } }, "SettingsComputer">>().params;
  const computer = useSirus((state) => state.computers.find((item) => item.id === computerId));
  const state = useSirus((store) => store.connection[computerId]);
  const data = useSirus((store) => store.data[computerId]);
  if (!computer) return <Page title="Computador"><Note>Este computador foi esquecido.</Note></Page>;
  const forget = () => Alert.alert(`Esquecer ${computerName(computer)}?`, "Este iPhone deixa de ver as conversas dele. Para voltar, pareie de novo com um código.", [
    { text: "Cancelar", style: "cancel" },
    { text: "Esquecer", style: "destructive", onPress: () => { void useSirus.getState().forgetComputer(computerId); navigation.goBack(); } },
  ]);
  return <Page title={computerName(computer)}>
    <ListSection>
      <ListRowLayout icon={icon("circle.fill")} label="Estado" detail={state === "open" ? "Conectado" : state === "lost" ? "Fora de alcance" : "Conectando…"} />
      <ListRowLayout icon={icon(computer.kind === "server" ? "server.rack" : "laptopcomputer")} label="Tipo" detail={computer.kind === "server" ? "Servidor" : "Mac"} />
      <ListRowLayout icon={icon("link")} label="Endereço" description={computer.baseUrl} />
      <ListRowLayout icon={icon("bubble.left.and.bubble.right")} label="Conversas" detail={data ? String(data.sessions.filter((session) => !session.sideChat).length) : "—"} />
      <ListRowLayout icon={icon("folder")} label="Projetos" detail={data ? String(data.projects.length) : "—"} />
    </ListSection>
    <ListSection>
      <Pressable onPress={forget} className="bg-grouped-card px-4 py-3.5 active:opacity-70">
        <AppText className="text-base text-danger-foreground">Esquecer este computador</AppText>
      </Pressable>
    </ListSection>
  </Page>;
}

export function SettingsAddComputerScreen() {
  const navigation = useNavigation();
  return <View className="flex-1 bg-sheet">
    <NativeStackScreenOptions options={{ title: "" }} />
    <ConnectScreen title="Conectar outro computador" onDone={() => navigation.goBack()} />
  </View>;
}

export function SettingsAlertsScreen() {
  return <Page title="Notificações">
    <ListSection title={t("mobile.agentActivity")}>
      <ListToggleRow icon={icon("bell.badge")} label="Notificações do aparelho" value={false} disabled onValueChange={() => {}} />
      <ListToggleRow icon={icon("bolt.circle")} label="Atualizações ao vivo" value={false} disabled onValueChange={() => {}} />
    </ListSection>
    <Note>Notificações e Atividades ao Vivo precisam da conta paga da Apple. Enquanto isso, os alertas chegam pelo Sirus da Tela de Início (aberto pelo Safari).</Note>
  </Page>;
}

/** The appearance page: color scheme and themes with previews, text, terminal and code sizes. */
export function SettingsAppearanceScreen() {
  return <Page title={t("mobile.appearance")}>
    <ThemeAppearanceSection />
    <TextAppearanceSection />
    <TerminalAppearanceSection />
    <CodeAppearanceSection />
  </Page>;
}

export function SettingsKeyboardScreen() {
  const returnKey = useSirus((state) => state.prefs.returnKey);
  return <Page title={t("mobile.keyboard")}>
    <ListSection title={t("mobile.returnKey")}>
      {([["send", "mobile.return.send", "Return envia a mensagem."], ["newline", "mobile.return.newline", "Return adiciona uma linha. Envie pelo botão."]] as const).map(([id, label, help], index) =>
        <ListChoiceRow key={id} label={t(label)} description={help} selected={returnKey === id} separated={index > 0} onPress={() => useSirus.getState().setPrefs({ returnKey: id })} />)}
    </ListSection>
  </Page>;
}

export function SettingsOrganizationScreen() {
  const order = useSirus((state) => state.prefs.threadOrder);
  return <Page title={t("mobile.organization")}>
    <ListSection title="Ordem das conversas">
      {(["updated_at", "created_at"] as const).map((id, index) => <ListChoiceRow key={id} label={t(`phoneHome.arrange.${id}`)} selected={order === id} separated={index > 0}
        onPress={() => useSirus.getState().setPrefs({ threadOrder: id })} />)}
    </ListSection>
    <Note>As fixadas ficam sempre no topo.</Note>
  </Page>;
}

/** Archived or snoozed conversations of every computer, with their way back and delete. */
function ConversationList(props: { readonly kind: "archived" | "snoozed" }) {
  const data = useSirus((state) => state.data);
  const computers = useSirus((state) => state.computers);
  const [query, setQuery] = useState("");
  const [computerFilter, setComputerFilter] = useState<string | null>(null);
  const all = useMemo(() => {
    const list: { computerId: string; session: Session; project?: string }[] = [];
    for (const [computerId, value] of Object.entries(data)) {
      const archived = new Set(value.settings?.archivedSessionIds ?? []);
      const projects = new Map(value.projects.map((project) => [project.id, project.name]));
      for (const session of value.sessions) {
        if (session.sideChat) continue;
        if (props.kind === "archived" ? archived.has(session.id) : !archived.has(session.id) && isSnoozed(session)) list.push({ computerId, session, project: projects.get(session.projectId) });
      }
    }
    return list.sort((a, b) => b.session.lastActivityAt.localeCompare(a.session.lastActivityAt));
  }, [data, props.kind]);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return all.filter((row) => (!computerFilter || row.computerId === computerFilter)
      && (!needle || row.session.title.toLocaleLowerCase().includes(needle) || (row.project ?? "").toLocaleLowerCase().includes(needle)));
  }, [all, query, computerFilter]);
  const filterMenu = useMemo(() => ({
    title: "Computador",
    items: [
      { type: "action" as const, title: "Todos os computadores", state: computerFilter === null ? "on" as const : "off" as const, onPress: () => setComputerFilter(null) },
      ...computers.map((computer) => ({ type: "action" as const, title: computerName(computer), state: computerFilter === computer.id ? "on" as const : "off" as const, onPress: () => setComputerFilter(computer.id) })),
    ],
  }), [computers, computerFilter]);
  const several = computers.length > 1;
  const act = (computerId: string, session: Session) => {
    const run = (action: Parameters<ReturnType<typeof useSirus.getState>["rowAction"]>[2]) =>
      void useSirus.getState().rowAction(computerId, session.id, action).catch((reason: unknown) => Alert.alert(session.title, reason instanceof Error ? reason.message : String(reason)));
    Alert.alert(session.title || "Conversa", undefined, [
      props.kind === "archived" ? { text: t("mobile.unarchive"), onPress: () => run({ type: "unarchive" }) } : { text: t("snooze.return"), onPress: () => run({ type: "snooze", until: null }) },
      { text: t("mobile.delete"), style: "destructive", onPress: () => Alert.alert("Excluir a conversa?", "Não dá para desfazer.", [
        { text: "Cancelar", style: "cancel" },
        { text: "Excluir", style: "destructive", onPress: () => run({ type: "delete", removeWorktree: false }) },
      ]) },
      { text: "Cancelar", style: "cancel" },
    ]);
  };
  return <Page title={props.kind === "archived" ? t("mobile.archivedConversations") : "Conversas adiadas"}>
    {/* The archive: filter and search in the bottom glass toolbar. */}
    <NativeStackScreenOptions optionsVersion={[filterMenu.items, computerFilter]} options={{
      headerSearchBarOptions: { autoCapitalize: "none", onCancelButtonPress: () => setQuery("") },
      unstable_headerToolbarItems: () => [createNativeMailSearchToolbarItem({
        filterMenu, filterButtonId: `${props.kind}-filter`, filterSystemImageName: computerFilter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle",
        onSearchTextChange: setQuery, placeholder: "Buscar", searchTextChangeId: `${props.kind}-search-text`, showsSearchDismissButton: true,
      } as never)],
    }} />
    {rows.length ? <ListSection>
      {rows.map((row) => <Pressable key={`${row.computerId}:${row.session.id}`} onPress={() => act(row.computerId, row.session)} className="bg-grouped-card active:opacity-70">
        <View className="flex-row items-center gap-3 px-4 py-3">
          <ProviderIcon provider={row.session.agent} size={16} />
          <View className="min-w-0 flex-1">
            <AppText numberOfLines={1} className="text-base">{row.session.title || "Conversa"}</AppText>
            <AppText numberOfLines={1} className="text-xs text-foreground-muted">
              {[row.project, several ? computerName(computers.find((computer) => computer.id === row.computerId) ?? { hostName: "", kind: "mac" }) : null,
                props.kind === "snoozed" && row.session.snoozedUntil ? snoozeCountdown(row.session.snoozedUntil, new Date(), t) : null].filter(Boolean).join(" · ")}
            </AppText>
          </View>
        </View>
      </Pressable>)}
    </ListSection> : <AppText className="mt-10 text-center text-sm text-foreground-muted">{query || computerFilter ? "Nada encontrado." : props.kind === "archived" ? "Nenhuma conversa arquivada." : "Nenhuma conversa adiada."}</AppText>}
    <View className="h-16" />
  </Page>;
}
export const SettingsArchivedScreen = () => <ConversationList kind="archived" />;
export const SettingsSnoozedScreen = () => <ConversationList kind="snoozed" />;

/**
 * A computer's own settings page (ADR-130): the chosen computer (when there are several), then
 * its settings, saved on it through `save_settings`. Nothing changes while it is out of reach.
 */
function MacPage(props: { readonly title: string; readonly children: (settings: AppSettings, save: (patch: Partial<AppSettings>) => void, disabled: boolean, server: boolean) => ReactNode }) {
  const computers = useSirus((state) => state.computers);
  const chosen = useSettingsComputer((state) => state.id);
  const computer = computers.find((item) => item.id === chosen) ?? computers[0];
  const settings = useSirus((state) => computer ? state.data[computer.id]?.settings ?? null : null);
  const online = useSirus((state) => computer ? state.connection[computer.id] === "open" : false);
  const disabled = !online || !settings;
  const save = (patch: Partial<AppSettings>) => {
    if (disabled || !computer) return;
    void useSirus.getState().saveSettings(computer.id, patch).catch((reason: unknown) => Alert.alert(props.title, reason instanceof Error ? reason.message : String(reason)));
  };
  return <Page title={props.title}>
    {computers.length > 1 ? <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Menu accessibilityLabel="Computador" icon="line.3.horizontal.decrease" title="Computador">
        {computers.map((item) => <NativeHeaderToolbar.MenuAction key={item.id} isOn={item.id === computer?.id} onPress={() => useSettingsComputer.getState().set(item.id)}>
          <NativeHeaderToolbar.Label>{computerName(item)}</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>)}
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar> : null}
    {settings ? props.children(settings, save, disabled, computer?.kind === "server") : <ActivityIndicator className="mt-10" />}
    {online ? null : <Note>{t("phoneSettings.offline")}</Note>}
  </Page>;
}

export function SettingsNewConversationsScreen() {
  return <MacPage title={t("phoneSettings.newConversations")}>{(settings, save, disabled) => <>
    <ListSection title="Espaço de trabalho padrão">
      {WORKSPACE_CHOICES.map((choice, index) => <ListChoiceRow key={choice.mode} label={t(choice.label)} description={t(choice.help)} selected={settings.defaultSessionWorkspace === choice.mode}
        separated={index > 0} disabled={disabled} onPress={() => save({ defaultSessionWorkspace: choice.mode })} />)}
    </ListSection>
    <ListSection title={t("settings.defaultApproval")}>
      {APPROVAL_CHOICES.map((choice, index) => <ListChoiceRow key={choice.mode} label={t(choice.label)} description={t(choice.help)} selected={settings.defaultApproval === choice.mode}
        separated={index > 0} disabled={disabled} onPress={() => save({ defaultApproval: choice.mode })} />)}
    </ListSection>
  </>}</MacPage>;
}

export function SettingsConversationBehaviorScreen() {
  return <MacPage title={t("phoneSettings.conversationBehavior")}>{(settings, save, disabled) => {
    const days = settings.autoArchiveInactiveDays;
    return <ListSection title={t("settings.autoArchive")}>
      <ListToggleRow icon={icon("arrow.triangle.merge")} label={t("settings.autoArchiveMerged")} description={t("settings.autoArchiveMergedHelp")} value={settings.autoArchiveMerged} disabled={disabled}
        onValueChange={(autoArchiveMerged) => save({ autoArchiveMerged })} />
      <ListToggleRow icon={icon("clock")} label={t("settings.autoArchiveInactive", { days: days ?? AUTO_ARCHIVE_DEFAULT_DAYS })} description={t("settings.autoArchiveInactiveHelp")} value={days !== null} disabled={disabled}
        onValueChange={(on) => save({ autoArchiveInactiveDays: on ? AUTO_ARCHIVE_DEFAULT_DAYS : null })} />
      {days !== null ? <ListRowLayout label={t("settings.inactiveDays")} accessory={<View className="flex-row items-center gap-1">
        <Stepper symbol="minus" disabled={disabled || days <= 1} onPress={() => save({ autoArchiveInactiveDays: clampArchiveDays(days - 1) })} />
        <AppText className="w-8 text-center text-base">{days}</AppText>
        <Stepper symbol="plus" disabled={disabled || days >= AUTO_ARCHIVE_MAX_DAYS} onPress={() => save({ autoArchiveInactiveDays: clampArchiveDays(days + 1) })} />
      </View>} /> : null}
    </ListSection>;
  }}</MacPage>;
}

function Stepper(props: { readonly symbol: "minus" | "plus"; readonly disabled: boolean; readonly onPress: () => void }) {
  return <Pressable onPress={props.onPress} disabled={props.disabled} hitSlop={6} className="size-8 items-center justify-center rounded-full bg-sheet active:opacity-60 disabled:opacity-30">
    <SymbolView name={props.symbol} size={12} weight="semibold" tintColorClassName="accent-foreground" />
  </Pressable>;
}

export function SettingsSourceControlScreen() {
  return <MacPage title={t("phoneSettings.sourceControl")}>{(settings, save, disabled) => <>
    <ListSection title={t("phoneSettings.defaultBranch")}>
      <ListToggleRow icon={icon("arrow.down.circle")} label={t("settings.autoPull")} description={t("settings.autoPullHelp")} value={settings.gitAutoPull} disabled={disabled} onValueChange={(gitAutoPull) => save({ gitAutoPull })} />
    </ListSection>
    <ListSection title={t("phoneSettings.worktrees")}>
      <ListToggleRow icon={icon("arrow.triangle.branch")} label={t("settings.fromOrigin")} description={t("settings.fromOriginHelp")} value={settings.worktreesFromOrigin} disabled={disabled} onValueChange={(worktreesFromOrigin) => save({ worktreesFromOrigin })} />
    </ListSection>
  </>}</MacPage>;
}

export function SettingsAgentBehaviorScreen() {
  return <MacPage title="Comportamento do agente">{(settings, save, disabled, server) => <>
    <ListSection title={t("settings.responseStreaming")}>
      {STREAMING_CHOICES.map((choice, index) => <ListChoiceRow key={choice.mode} label={t(choice.label)} description={t(choice.help)} selected={settings.responseStreaming === choice.mode}
        separated={index > 0} disabled={disabled} onPress={() => save({ responseStreaming: choice.mode })} />)}
    </ListSection>
    <Note>{t("settings.responseStreamingHelp")}</Note>
    {server ? null : <ListSection title={t("phoneSettings.browser")}>
      <ListToggleRow icon={icon("globe")} label={t("settings.browserAccess")} description={t("settings.browserAccessHelp")} value={settings.agentBrowserAccess} disabled={disabled} onValueChange={(agentBrowserAccess) => save({ agentBrowserAccess })} />
    </ListSection>}
  </>}</MacPage>;
}

export function SettingsMaintenanceScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const computers = useSirus((state) => state.computers);
  return <MacPage title={t("phoneSettings.maintenance")}>{(settings, save, disabled) => <>
  <ListSection title="Gerenciar computadores">
    {computers.map((computer) => <ListRow key={computer.id} icon={icon(computer.kind === "server" ? "server.rack" : "desktopcomputer")} label={computerName(computer)}
      detail={computer.kind === "server" ? "Servidor" : "Mac"} onPress={() => navigation.navigate("SettingsComputer", { computerId: computer.id })} />)}
  </ListSection>
  <ListSection title={t("phoneSettings.updates")}>
    <ListToggleRow icon={icon("arrow.clockwise")} label={t("Check for CLI updates")} description={t("Check Codex, Claude and other provider CLIs for newer versions in the background.")} value={settings.enableProviderUpdateChecks} disabled={disabled}
      onValueChange={(enableProviderUpdateChecks) => save({ enableProviderUpdateChecks })} />
    <ListToggleRow icon={icon("arrow.uturn.backward")} label={t("chatBehavior.continueInterrupted")} description={t("chatBehavior.continueInterruptedHelp")} value={settings.continueInterruptedSessions} disabled={disabled}
      onValueChange={(continueInterruptedSessions) => save({ continueInterruptedSessions })} />
  </ListSection>
  </>}</MacPage>;
}

/** Usage and limits of each provider on each computer (`provider_usage`), as the web app's. */
export function SettingsUsageScreen() {
  const computers = useSirus((state) => state.computers);
  const data = useSirus((state) => state.data);
  const agents = useSirus((state) => state.agents);
  const [usage, setUsage] = useState<Record<string, ProviderUsage | "loading" | "error">>({});
  const [now] = useState(() => Date.now());
  const entries = useMemo(() => computers.flatMap((computer) => {
    const settings = data[computer.id]?.settings;
    if (!settings) return [];
    return USAGE_PROVIDER_IDS
      .filter((id) => (agents[computer.id] ?? []).some((agent) => agent.id === id && agent.installed) && isProviderEnabled(settings, id))
      .map((provider) => ({ computer, provider, key: `${computer.id}:${provider}` }));
  }), [agents, computers, data]);
  useEffect(() => { for (const computer of computers) if (!agents[computer.id]) void useSirus.getState().loadAgents(computer.id).catch(() => undefined); }, [agents, computers]);
  const keys = entries.map((entry) => entry.key).join(",");
  useEffect(() => {
    for (const entry of entries) {
      setUsage((current) => current[entry.key] ? current : { ...current, [entry.key]: "loading" });
      useSirus.getState().invoke<ProviderUsage>(entry.computer.id, "provider_usage", { provider: entry.provider, refresh: false })
        .then((value) => setUsage((current) => ({ ...current, [entry.key]: value })), () => setUsage((current) => ({ ...current, [entry.key]: "error" })));
    }
  }, [keys]); // once per set of providers
  const several = computers.length > 1;
  return <Page title={t("mobile.usage")}>
    {!entries.length ? <ActivityIndicator className="mt-10" /> : entries.map((entry) => {
      const value = usage[entry.key];
      const windows = typeof value === "object" ? orderedUsageWindows(value).filter((window) => window.usedPercent !== null) : [];
      return <ListSection key={entry.key} title={`${providerById(entry.provider).name}${several ? ` · ${computerName(entry.computer)}` : ""}`}
        titleIcon={<ProviderIcon provider={entry.provider} size={14} />}>
        <View className="gap-4 bg-grouped-card px-4 py-4">
          {typeof value === "object" && value.account?.plan ? <AppText className="text-sm text-foreground-muted">Plano {value.account.plan}</AppText> : null}
          {windows.length ? windows.map((window) => {
            const used = Math.max(0, Math.min(100, Math.round(window.usedPercent ?? 0)));
            const reset = resetDuration(window.resetsAt, now);
            return <View key={window.id} className="gap-1.5">
              <View className="flex-row justify-between"><AppText className="text-base">{t(usageWindowLabel(window))}</AppText><AppText className="text-base text-foreground-muted">{used}%</AppText></View>
              <View className="h-1.5 overflow-hidden rounded-full bg-subtle-strong">
                <View className={`h-full rounded-full ${used >= 90 ? "bg-danger-foreground" : used >= 70 ? "bg-warning" : "bg-foreground"}`} style={{ width: `${used}%` }} />
              </View>
              {reset ? <AppText className="text-xs text-foreground-muted">{t("mobile.resetsIn", { time: reset })}</AppText> : null}
            </View>;
          }) : <AppText className="text-sm text-foreground-muted">{value === "loading" || value === undefined ? "Carregando…" : typeof value === "object" && value.note ? value.note : t("mobile.usageUnavailable")}</AppText>}
        </View>
      </ListSection>;
    })}
  </Page>;
}

export function SettingsAboutScreen() {
  return <Page title={t("mobile.about")}>
    <ListSection>
      <ListRowLayout icon={icon("app.badge")} label="Sirus para iPhone" detail={`${Application.nativeApplicationVersion ?? "?"} (${Application.nativeBuildVersion ?? "?"})`} />
      <ListRowLayout icon={icon("arrow.down.app")} label="Atualização em uso" detail={runningUpdateLabel()} />
      <ListRow icon={icon("arrow.clockwise")} label="Procurar atualização" onPress={() => void checkForAppUpdate(true).then((result) => {
        if (result === "none") Alert.alert("Atualização", "Você já está na versão mais nova.");
        else if (result === "unavailable") Alert.alert("Atualização", "Não foi possível procurar agora. O computador que publica as atualizações precisa estar conectado.");
      })} />
      <ListRow icon={icon("chevron.left.forwardslash.chevron.right")} label="Código do Sirus" detail="GitHub" onPress={() => void Linking.openURL("https://github.com/viannaanalyst/sirus-code")} />
    </ListSection>
    <ListSection>
      <ListRow icon={icon("doc.text")} label="Licenças de código aberto" onPress={() => void Linking.openURL("https://github.com/viannaanalyst/sirus-code/blob/main/THIRD-PARTY-NOTICES.md")} />
    </ListSection>
  </Page>;
}
