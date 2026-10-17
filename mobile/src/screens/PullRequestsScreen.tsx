import { useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from "@react-navigation/native";
import type { GithubDetail, GithubItem, GithubItemState, GithubMergeMethod, PullRequestResponse } from "@sirus/client/types";
import { matchesPullRequestQuery, parsePullRequestQuery } from "@sirus/lib/pull-request-query";
import { relativeTime } from "@sirus/lib/session-board";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../components/AppSymbol";
import { AppText } from "../components/AppText";
import { ControlPillMenu } from "../components/ControlPillMenu";
import { GlassSurface } from "../components/GlassSurface";
import { ListSection } from "../components/ListSection";
import { Markdown } from "../components/Markdown";
import { SegmentedControl } from "../components/SegmentedControl";
import { prKey, projectRepositories, usePullRequests } from "../data/pull-requests";
import { useSirus } from "../data/store";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";
import { EmptyState } from "./ConversationsScreen";

type Params = {
  PullRequests: { computerId: string; projectId?: string };
  PullRequest: { computerId: string; repository: string; number: number };
};

const STATES: readonly { id: GithubItemState; label: string }[] = [
  { id: "open", label: "Abertos" },
  { id: "merged", label: "Com merge" },
  { id: "closed", label: "Fechados" },
];

const METHODS: Record<GithubMergeMethod, string> = { squash: "Squash e merge", merge: "Criar commit de merge", rebase: "Rebase e merge" };

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const when = (iso: string) => { const value = relativeTime(iso); return value === "now" ? "agora" : value; };

/** A pull request's checks, as one word and colour. */
function checksLabel(checks: string | null): { icon: string; text: string; className: string } | null {
  if (!checks) return null;
  const value = checks.toLowerCase();
  if (value.includes("fail") || value.includes("error")) return { icon: "xmark.circle.fill", text: "checks falharam", className: "text-danger-foreground" };
  if (value.includes("pend") || value.includes("progress") || value.includes("queued")) return { icon: "circle.dashed", text: "checks rodando", className: "text-adaptive-sky-600-400" };
  if (value.includes("success") || value.includes("pass")) return { icon: "checkmark.circle.fill", text: "checks ok", className: "text-adaptive-emerald-600-400" };
  return null;
}

function reviewLabel(decision: string | null): string | null {
  if (decision === "APPROVED") return "aprovado";
  if (decision === "CHANGES_REQUESTED") return "pediram mudanças";
  if (decision === "REVIEW_REQUIRED") return "aguarda revisão";
  return null;
}

/** Where a pull request sits on the list: ready, waiting, or asking the person for a review. */
function group(item: GithubItem, viewer: string | null): "ready" | "review" | "waiting" {
  if (viewer && item.reviewRequests.includes(viewer)) return "review";
  if (!item.isDraft && item.reviewDecision === "APPROVED" && item.mergeable !== "CONFLICTING" && !checksLabel(item.checks)?.text.includes("falharam")) return "ready";
  return "waiting";
}

const GROUPS = [
  { id: "ready", title: "Prontos para merge" },
  { id: "review", title: "Revisão pedida a você" },
  { id: "waiting", title: "Aguardando" },
] as const;

/**
 * A computer's GitHub pull requests (a project's, when opened from its page): open, merged or
 * closed; open ones grouped into ready to merge, asking you for a review, and waiting.
 */
export function PullRequestsScreen() {
  const { computerId, projectId } = useRoute<RouteProp<Params, "PullRequests">>().params;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [state, setState] = useState<GithubItemState>("open");
  const entry = usePullRequests((store) => store.entries[prKey(computerId, state)]);
  const openEntry = usePullRequests((store) => store.entries[prKey(computerId)]);
  const project = useSirus((store) => projectId ? store.data[computerId]?.projects.find((item) => item.id === projectId) : undefined);
  const [refreshing, setRefreshing] = useState(false);
  /** The header search, with GitHub's `label:`, `author:`, `draft:`, `review:` and `status:` qualifiers. */
  const [query, setQuery] = useState("");
  const parsedQuery = useMemo(() => parsePullRequestQuery(query.trim()), [query]);
  const searching = !!query.trim();
  useEffect(() => { void usePullRequests.getState().load(computerId, state); }, [computerId, state]);
  const repositories = projectId ? projectRepositories(openEntry?.inbox ?? entry?.inbox, projectId) : null;
  const viewer = entry?.inbox?.viewer ?? null;
  const projectItems = useMemo(() => (entry?.inbox?.items ?? []).filter((item) => !repositories || repositories.includes(item.repository)), [entry, repositories]);
  const items = useMemo(() => searching ? projectItems.filter((item) => matchesPullRequestQuery(item, parsedQuery, viewer)) : projectItems, [projectItems, parsedQuery, searching, viewer]);
  const failure = entry?.inbox?.failures.find((item) => !repositories || repositories.includes(item.repository));

  const row = (item: GithubItem, index: number) => {
    const checks = checksLabel(item.checks);
    const review = reviewLabel(item.reviewDecision);
    const icon = item.state === "merged" ? "arrow.triangle.merge" : item.state === "closed" ? "git.pull-request.closed" : item.isDraft ? "git.pull-request.draft" : "arrow.triangle.pull";
    const tint = item.state === "merged" ? "#a16ae8" : item.state === "closed" ? "#e5604d" : item.isDraft ? "#8e8e93" : "#30a46c";
    return <Pressable key={`${item.repository}#${item.number}`} onPress={() => navigation.navigate("PullRequest", { computerId, repository: item.repository, number: item.number })}
      accessibilityRole="button" accessibilityLabel={item.title} className="bg-grouped-card active:bg-row-hover">
      {index > 0 ? <View className="absolute left-[50px] right-0 top-0 bg-separator" style={{ height: StyleSheet.hairlineWidth }} /> : null}
      <View className="flex-row gap-3 px-4 py-3">
        <View className="pt-0.5"><SymbolView name={icon as AppSymbolName} size={18} tintColor={tint} /></View>
        <View className="min-w-0 flex-1 gap-1">
          <AppText numberOfLines={2} className="font-app-medium text-base">{item.title}</AppText>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
            {checks ? <View className="flex-row items-center gap-1">
              <SymbolView name={checks.icon as AppSymbolName} size={11} tintColorClassName={checks.className.replace("text-", "accent-") as never} />
              <AppText className={`font-app-medium text-xs ${checks.className}`}>{checks.text}</AppText>
            </View> : null}
            <AppText numberOfLines={1} className="shrink text-xs text-foreground-muted">
              #{item.number}{repositories && repositories.length < 2 ? "" : ` · ${item.repository.split("/").pop()}`}{review ? ` · ${review}` : ""}{item.isDraft ? " · rascunho" : ""} · {item.author ?? "?"} · {when(item.updatedAt)}
            </AppText>
          </View>
        </View>
        <AppText className="pt-0.5 text-xs tabular-nums">
          <AppText className="text-adaptive-emerald-600-400">+{item.additions}</AppText> <AppText className="text-danger-foreground">−{item.deletions}</AppText>
        </AppText>
      </View>
    </Pressable>;
  };

  const sections = state === "open"
    ? GROUPS.map((section) => ({ ...section, items: items.filter((item) => group(item, viewer) === section.id) })).filter((section) => section.items.length)
    : [{ id: state, title: "", items }];

  return <>
    <NativeStackScreenOptions options={{
      title: "Pull requests",
      headerSubtitle: project?.name,
      headerSearchBarOptions: { placeholder: "Buscar, label:, author:, draft:", autoCapitalize: "none", onChangeText: (event: { nativeEvent: { text: string } }) => setQuery(event.nativeEvent.text), onCancelButtonPress: () => setQuery("") },
    } as never} />
    <ScrollView className="flex-1 bg-screen" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-4 pb-10 pt-2"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void usePullRequests.getState().load(computerId, state, true).finally(() => setRefreshing(false)); }} />}>
      <SegmentedControl options={STATES.map((item) => ({ value: item.id, label: item.label }))} selected={state}
        onSelect={(value) => { void Haptics.selectionAsync().catch(() => undefined); setState(value); }} />
      {entry?.loading && !entry.inbox ? <ActivityIndicator className="mt-10" />
        : entry?.error && !entry.inbox ? <EmptyState icon="exclamationmark.triangle" text={`Não foi possível ler o GitHub: ${entry.error}`} />
        : failure && !projectItems.length ? <EmptyState icon="person.crop.circle.badge.exclamationmark" text={failure.status === "authRequired" ? "Entre no GitHub CLI (gh auth login) no computador para ver os pull requests." : failure.status === "cliMissing" ? "Instale o GitHub CLI (gh) no computador para ver os pull requests." : "O GitHub não respondeu para este repositório."} />
        : repositories && !repositories.length && entry?.inbox ? <EmptyState icon="arrow.triangle.pull" text="Este projeto não aponta para um repositório do GitHub." />
        : !items.length && entry?.inbox && searching && projectItems.length ? <EmptyState icon="magnifyingglass" text="Nenhum pull request combina com a busca." />
        : !items.length && entry?.inbox ? <EmptyState icon="arrow.triangle.pull" text={state === "open" ? "Nenhum pull request aberto." : state === "merged" ? "Nenhum pull request com merge." : "Nenhum pull request fechado."} />
        : sections.map((section) => <ListSection key={section.id} title={section.title ? `${section.title} · ${section.items.length}` : undefined}>{section.items.map(row)}</ListSection>)}
    </ScrollView>
  </>;
}

const CHECK_LOOK: Record<GithubDetail["checks"][number]["status"], { icon: string; className: string }> = {
  passed: { icon: "checkmark.circle.fill", className: "accent-adaptive-emerald-600-400" },
  failed: { icon: "xmark.circle.fill", className: "accent-danger-foreground" },
  pending: { icon: "circle.dashed", className: "accent-adaptive-sky-600-400" },
  skipped: { icon: "minus.circle", className: "accent-foreground-tertiary" },
  unknown: { icon: "questionmark.circle", className: "accent-foreground-tertiary" },
};

/**
 * One pull request: its state and title, a grouped summary (branch, changes, merge, reviews,
 * checks), the description, its checks and files, and "Fazer merge" pinned at the bottom with
 * the method in a menu beside it.
 */
export function PullRequestScreen() {
  const { computerId, repository, number } = useRoute<RouteProp<Params, "PullRequest">>().params;
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<GithubDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await useSirus.getState().invoke<PullRequestResponse>(computerId, "pull_request_action", { action: { type: "detail", repository, number, kind: "pullRequest" } });
      if (result.type === "detail") { setDetail(result); setError(null); }
    } catch (reason) { setError(errorText(reason)); }
  }, [computerId, repository, number]);
  useEffect(() => { void load(); }, [load]);

  const merge = (method: GithubMergeMethod) => {
    if (!detail?.headOid) return;
    Alert.alert(METHODS[method], `#${number} vai para ${detail.item.baseRef ?? "a branch principal"}.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Fazer merge", onPress: () => {
        setMerging(true);
        void useSirus.getState().invoke<PullRequestResponse>(computerId, "pull_request_action", { action: { type: "merge", repository, number, method, expectedHead: detail.headOid, confirm: true } })
          .then(() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); void usePullRequests.getState().load(computerId, "open", true); return load(); },
            (reason: unknown) => Alert.alert("Não foi possível fazer o merge", errorText(reason)))
          .finally(() => setMerging(false));
      } },
    ]);
  };

  const item = detail?.item;
  const open = item?.state === "open";
  const methods = detail?.mergeMethods.length ? detail.mergeMethods : (["squash", "merge", "rebase"] as GithubMergeMethod[]);
  const blocked = !detail?.viewerCanUpdate || item?.isDraft || item?.mergeable === "CONFLICTING";
  const passed = detail?.checks.filter((check) => check.status === "passed").length ?? 0;
  const failedChecks = detail?.checks.filter((check) => check.status === "failed").length ?? 0;
  const pendingChecks = detail?.checks.filter((check) => check.status === "pending").length ?? 0;
  const approvals = detail?.reviews.filter((review) => review.state === "APPROVED").length ?? 0;
  const badge = !item ? null : item.state === "merged" ? { text: "Merge feito", icon: "arrow.triangle.merge", tint: "#a16ae8" } : item.state === "closed" ? { text: "Fechado", icon: "git.pull-request.closed", tint: "#e5604d" } : item.isDraft ? { text: "Rascunho", icon: "git.pull-request.draft", tint: "#8e8e93" } : { text: "Aberto", icon: "arrow.triangle.pull", tint: "#30a46c" };

  return <View className="flex-1 bg-screen">
    <NativeStackScreenOptions options={{ title: `#${number}`, headerSubtitle: repository.split("/").pop() } as never} />
    {item ? <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Button accessibilityLabel="Abrir no GitHub" icon="safari" onPress={() => void Linking.openURL(item.url)} />
    </NativeHeaderToolbar> : null}
    <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-5 px-4 pt-2" contentContainerStyle={{ paddingBottom: insets.bottom + (open ? 96 : 32) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}>
      {!detail ? error ? <EmptyState icon="exclamationmark.triangle" text={error} /> : <ActivityIndicator className="mt-16" /> : <>
        <View className="gap-2.5 px-1">
          {badge ? <View className="flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: `${badge.tint}26` }}>
            <SymbolView name={badge.icon as AppSymbolName} size={12} tintColor={badge.tint} />
            <AppText className="font-app-bold text-xs" style={{ color: badge.tint }}>{badge.text}</AppText>
          </View> : null}
          <AppText className="font-app-bold text-2xl" selectable>{item!.title}</AppText>
          <AppText className="text-sm text-foreground-muted">{item!.author ?? "?"} · {when(item!.createdAt)}{item!.labels.length ? ` · ${item!.labels.map((label) => label.name).join(", ")}` : ""}</AppText>
        </View>
        <ListSection>
          <Fact icon="arrow.triangle.branch" label="Branch" value={`${item!.headRef ?? "?"} › ${item!.baseRef ?? "?"}`} />
          <Fact separated icon="plusminus" label="Alterações" value={<AppText className="text-sm tabular-nums"><AppText className="text-adaptive-emerald-600-400">+{item!.additions}</AppText> <AppText className="text-danger-foreground">−{item!.deletions}</AppText><AppText className="text-foreground-muted"> · {detail.changedFiles} {detail.changedFiles === 1 ? "arquivo" : "arquivos"}</AppText></AppText>}
            onPress={detail.files.length ? () => setShowFiles((value) => !value) : undefined} expanded={showFiles} />
          <Fact separated icon="arrow.triangle.merge" label="Merge" value={item!.state === "merged" ? `Feito ${detail.mergedAt ? when(detail.mergedAt) : ""}`.trim() : item!.state === "closed" ? "Fechado sem merge" : item!.mergeable === "CONFLICTING" ? "Tem conflitos" : item!.mergeable === "MERGEABLE" ? "Sem conflitos" : "Verificando…"}
            valueClassName={item!.state === "merged" ? "text-adaptive-violet-600-400" : item!.mergeable === "CONFLICTING" && open ? "text-danger-foreground" : item!.mergeable === "MERGEABLE" && open ? "text-adaptive-emerald-600-400" : undefined} />
          <Fact separated icon="person.2" label="Revisões" value={approvals ? `${approvals} ${approvals === 1 ? "aprovação" : "aprovações"}` : detail.reviewers.length ? `Pedida a ${detail.reviewers.join(", ")}` : "Nenhuma"} />
          <Fact separated icon="checkmark.circle" label="Checks" value={!detail.checks.length ? "Nenhum" : failedChecks ? `${failedChecks} falharam` : pendingChecks ? `${pendingChecks} rodando` : `${passed} passaram`}
            valueClassName={failedChecks ? "text-danger-foreground" : pendingChecks ? "text-adaptive-sky-600-400" : detail.checks.length ? "text-adaptive-emerald-600-400" : undefined}
            onPress={detail.checks.length ? () => setShowChecks((value) => !value) : undefined} expanded={showChecks} />
        </ListSection>
        {showFiles ? <ListSection title="Arquivos">
          {detail.files.map((file, index) => <View key={file.path} className={`flex-row items-center gap-2 bg-grouped-card px-4 py-2.5 ${index ? "border-t border-border-subtle" : ""}`}>
            <AppText numberOfLines={1} ellipsizeMode="head" className="flex-1 font-mono text-xs">{file.path}</AppText>
            <AppText className="text-xs tabular-nums"><AppText className="text-adaptive-emerald-600-400">+{file.additions}</AppText> <AppText className="text-danger-foreground">−{file.deletions}</AppText></AppText>
          </View>)}
        </ListSection> : null}
        {showChecks ? <ListSection title="Checks">
          {detail.checks.map((check, index) => <Pressable key={`${check.name}:${index}`} disabled={!check.url} onPress={() => check.url && void Linking.openURL(check.url)}
            className={`flex-row items-center gap-2.5 bg-grouped-card px-4 py-2.5 active:bg-row-hover ${index ? "border-t border-border-subtle" : ""}`}>
            <SymbolView name={CHECK_LOOK[check.status].icon as AppSymbolName} size={15} tintColorClassName={CHECK_LOOK[check.status].className as never} />
            <AppText numberOfLines={1} className="flex-1 text-sm">{check.name}</AppText>
          </Pressable>)}
        </ListSection> : null}
        <View className="gap-2 px-1">
          <AppText className="text-sm font-app-medium text-foreground-muted">Descrição</AppText>
          {detail.body.trim() ? <Markdown markdown={detail.body} onLinkPress={(url) => void Linking.openURL(url)} /> : <AppText className="text-sm text-foreground-muted">Sem descrição.</AppText>}
        </View>
      </>}
    </ScrollView>
    {open && detail ? <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 px-4" style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
      <GlassSurface glassEffectStyle="regular" style={{ borderRadius: 999 }}>
        <View className={`flex-row items-center ${blocked ? "opacity-50" : ""}`}>
          <Pressable disabled={blocked || merging} onPress={() => merge(methods[0]!)} accessibilityRole="button" accessibilityLabel={METHODS[methods[0]!]}
            className="h-14 flex-1 flex-row items-center justify-center gap-2 active:opacity-70">
            {merging ? <ActivityIndicator /> : <SymbolView name="arrow.triangle.merge" size={17} tintColorClassName="accent-foreground" />}
            <AppText className="font-app-bold text-base">{item?.isDraft ? "Rascunho: sem merge" : item?.mergeable === "CONFLICTING" ? "Resolva os conflitos" : !detail.viewerCanUpdate ? "Sem permissão para merge" : "Fazer merge"}</AppText>
          </Pressable>
          {methods.length > 1 && !blocked ? <ControlPillMenu actions={methods.map((method) => ({ id: method, title: METHODS[method] }))} onPressAction={({ nativeEvent }) => merge(nativeEvent.event as GithubMergeMethod)}>
            <Pressable accessibilityRole="button" accessibilityLabel="Escolher o tipo de merge" className="h-14 w-14 items-center justify-center border-l border-border-subtle active:opacity-70">
              <SymbolView name="chevron.down" size={14} weight="semibold" tintColorClassName="accent-foreground" />
            </Pressable>
          </ControlPillMenu> : null}
        </View>
      </GlassSurface>
    </View> : null}
  </View>;
}

function Fact(props: { readonly icon: string; readonly label: string; readonly value: React.ReactNode; readonly valueClassName?: string; readonly separated?: boolean; readonly onPress?: () => void; readonly expanded?: boolean }) {
  return <Pressable disabled={!props.onPress} onPress={props.onPress} className="bg-grouped-card active:bg-row-hover">
    {props.separated ? <View className="absolute left-4 right-0 top-0 bg-separator" style={{ height: StyleSheet.hairlineWidth }} /> : null}
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-2.5">
      <View className="w-[104px] flex-row items-center gap-2">
        <SymbolView name={props.icon as AppSymbolName} size={14} tintColorClassName="accent-foreground-muted" />
        <AppText className="text-sm text-foreground-muted">{props.label}</AppText>
      </View>
      <View className="min-w-0 flex-1">{typeof props.value === "string" ? <AppText numberOfLines={1} className={`text-sm ${props.valueClassName ?? ""}`}>{props.value}</AppText> : props.value}</View>
      {props.onPress ? <SymbolView name={props.expanded ? "chevron.up" : "chevron.down"} size={11} weight="semibold" tintColorClassName="accent-chevron" /> : null}
    </View>
  </Pressable>;
}
