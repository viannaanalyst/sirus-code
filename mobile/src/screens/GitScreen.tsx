import { useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, SectionList, View } from "react-native";

import type { GitCommitResult, GitPushResult, GitWorkspaceEntry, GitWorkspaceResponse, GitWorkspaceSnapshot } from "@sirus/client/types";

import { SymbolView } from "../components/AppSymbol";
import { AppText } from "../components/AppText";
import { useSirus } from "../data/store";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";

type GitParams = {
  Git: { computerId: string; sessionId: string };
  Diff: { computerId: string; sessionId: string; path: string; staged: boolean; indexToken: string };
};

const KIND: Record<GitWorkspaceEntry["kind"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-adaptive-emerald-600-400" },
  untracked: { letter: "U", className: "text-adaptive-emerald-600-400" },
  modified: { letter: "M", className: "text-warning" },
  renamed: { letter: "R", className: "text-warning" },
  deleted: { letter: "D", className: "text-danger-foreground" },
};

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

/**
 * The conversation's Git on its computer, as the desktop's Changes pane: staged and unstaged
 * files (tap the circle to move one), each file's diff, then commit, push and pull. A commit
 * with nothing staged takes every change.
 */
export function GitScreen() {
  const { computerId, sessionId } = useRoute<RouteProp<GitParams, "Git">>().params;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const invoke = useCallback(<T,>(command: string, args: Record<string, unknown>) => useSirus.getState().invoke<T>(computerId, command, args), [computerId]);
  const action = useCallback((value: Record<string, unknown>) => invoke<GitWorkspaceResponse>("git_workspace_action", { action: { sessionId, ...value } }), [invoke, sessionId]);

  const refresh = useCallback(async () => {
    try {
      const result = await action({ type: "snapshot" });
      if (result.type === "snapshot") { setSnapshot(result.snapshot); setError(null); }
    } catch (reason) { setError(errorText(reason)); }
  }, [action]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try { await task(); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }
    catch (reason) { Alert.alert(label, errorText(reason)); }
    finally { setBusy(null); await refresh(); }
  };

  const toggle = (entry: GitWorkspaceEntry, staged: boolean) => {
    if (!snapshot || !entry.actionable) return;
    void Haptics.selectionAsync();
    void run(staged ? "Tirar do commit" : "Incluir no commit", async () => {
      await action({ type: staged ? "unstage" : "stage", paths: [entry.path], expectedIndex: snapshot.indexToken });
    });
  };

  const commit = () => {
    if (!snapshot) return;
    Alert.prompt("Commit", snapshot.staged.length ? `${snapshot.staged.length} arquivo(s) preparados.` : "Nada preparado: o commit leva todas as alterações.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Commit", onPress: (message?: string) => {
        if (!message?.trim()) return;
        void run("Commit", async () => {
          let expected = snapshot.indexToken;
          if (!snapshot.staged.length) {
            const paths = snapshot.unstaged.filter((entry) => entry.actionable).map((entry) => entry.path);
            await action({ type: "stage", paths, expectedIndex: expected });
            const fresh = await action({ type: "snapshot" });
            if (fresh.type === "snapshot") expected = fresh.snapshot.indexToken;
          }
          const result = await invoke<GitCommitResult>("git_commit", { sessionId, message: message.trim(), expectedIndex: expected });
          Alert.alert("Commit feito", `${result.hash.slice(0, 7)} ${result.summary}`, [
            { text: "OK" },
            { text: "Push", onPress: () => push() },
          ]);
        });
      } },
    ], "plain-text");
  };
  const push = () => void run("Push", async () => {
    const result = await invoke<GitPushResult>("git_push", { sessionId });
    Alert.alert("Push feito", `Enviado para ${result.branch}.`);
  });
  const pull = () => void run("Pull", async () => {
    const result = await action({ type: "pull", confirm: true });
    if (result.type === "pulled") Alert.alert("Pull feito", result.summary || result.branch);
  });

  const sections = useMemo(() => snapshot ? [
    ...(snapshot.staged.length ? [{ title: "Preparados para o commit", staged: true, data: snapshot.staged }] : []),
    ...(snapshot.unstaged.length ? [{ title: "Alterações", staged: false, data: snapshot.unstaged }] : []),
  ] : [], [snapshot]);
  const branch = snapshot?.identity.branch ?? (snapshot?.identity.detached ? "HEAD solto" : "");
  const sync = [snapshot?.ahead ? `${snapshot.ahead}↑` : "", snapshot?.behind ? `${snapshot.behind}↓` : ""].filter(Boolean).join(" ");

  return <View className="flex-1 bg-thread-canvas">
    <NativeStackScreenOptions options={{ title: "Git", unstable_headerSubtitle: [branch, sync].filter(Boolean).join(" · ") || undefined }} optionsVersion={[branch, sync]} />
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Menu accessibilityLabel="Ações do Git" icon="ellipsis">
        <NativeHeaderToolbar.MenuAction icon="checkmark.circle" disabled={!snapshot || (!snapshot.staged.length && !snapshot.unstaged.length)} onPress={commit}>
          <NativeHeaderToolbar.Label>Commit…</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="arrow.up.circle" onPress={push}>
          <NativeHeaderToolbar.Label>Push</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="arrow.down.circle" onPress={pull}>
          <NativeHeaderToolbar.Label>Pull</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="arrow.clockwise" onPress={() => void refresh()}>
          <NativeHeaderToolbar.Label>Atualizar</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar>
    {!snapshot && !error ? <ActivityIndicator className="mt-24" /> : <SectionList
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(entry, index) => `${entry.path}:${index}`}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={busy ? <View className="flex-row items-center gap-2 px-5 py-2"><ActivityIndicator size="small" /><AppText className="text-sm text-foreground-muted">{busy}…</AppText></View> : undefined}
      ListEmptyComponent={<AppText className="mt-16 px-8 text-center text-sm text-foreground-muted">{error ?? (snapshot?.identity.isRepo === false ? "Esta pasta não é um repositório Git." : "Nenhuma alteração.")}</AppText>}
      renderSectionHeader={({ section }) => <AppText className="px-5 pb-1 pt-4 text-xs text-foreground-muted">{section.title} {section.data.length}</AppText>}
      renderItem={({ item, section }) => <Pressable
        onPress={() => snapshot && navigation.navigate("Diff", { computerId, sessionId, path: item.path, staged: section.staged, indexToken: snapshot.indexToken })}
        className="flex-row items-center gap-3 px-5 py-2.5 active:bg-row-hover">
        <Pressable onPress={() => toggle(item, section.staged)} hitSlop={10} disabled={!item.actionable || !!busy} accessibilityLabel={section.staged ? "Tirar do commit" : "Incluir no commit"}>
          <SymbolView name={section.staged ? "checkmark.circle.fill" : "circle"} size={20} tintColorClassName={section.staged ? "accent-icon" : "accent-foreground-tertiary"} />
        </Pressable>
        <View className="min-w-0 flex-1">
          <AppText numberOfLines={1} className="text-base">{item.path.split("/").pop()}</AppText>
          <AppText numberOfLines={1} className="text-xs text-foreground-muted">{item.path}</AppText>
        </View>
        <AppText className={`font-app-medium text-xs ${item.conflicted ? "text-danger-foreground" : KIND[item.kind].className}`}>{item.conflicted ? "!" : KIND[item.kind].letter}</AppText>
      </Pressable>}
      contentContainerStyle={{ paddingBottom: 40 }}
    />}
  </View>;
}

/** One file's diff, lines colored as added, removed or hunk headers. */
export function DiffScreen() {
  const codeSize = useAppearancePreferences().appearance.codeFontSize;
  const { computerId, sessionId, path, staged, indexToken } = useRoute<RouteProp<GitParams, "Diff">>().params;
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    useSirus.getState().invoke<GitWorkspaceResponse>(computerId, "git_workspace_action", { action: { type: "diff", sessionId, path, staged, expectedIndex: indexToken } })
      .then((result) => setDiff(result.type === "diff" ? result.diff : ""), (reason: unknown) => setError(errorText(reason)));
  }, [computerId, sessionId, path, staged, indexToken]);
  const lines = useMemo(() => (diff ?? "").split("\n").filter((line) => !/^(diff --git|index |--- |\+\+\+ )/.test(line)), [diff]);
  return <View className="flex-1 bg-thread-canvas">
    <NativeStackScreenOptions options={{ title: path.split("/").pop() ?? path, unstable_headerSubtitle: path }} />
    {diff === null && !error ? <ActivityIndicator className="mt-24" />
      : error || !lines.some(Boolean) ? <AppText className="mt-16 px-8 text-center text-sm text-foreground-muted">{error ?? "Sem diferenças de texto."}</AppText>
      : <ScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 12, paddingBottom: 60 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {lines.map((line, index) => {
                const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
                return <AppText key={index} selectable
                  className={kind === "add" ? "bg-adaptive-emerald-500-a12-a16 text-foreground" : kind === "del" ? "bg-adaptive-rose-500-a12-a16 text-foreground" : kind === "hunk" ? "text-foreground-muted" : "text-foreground-secondary"}
                  style={{ fontFamily: "Menlo", fontSize: codeSize, lineHeight: Math.round(codeSize * 1.5), paddingHorizontal: 14, paddingTop: kind === "hunk" && index ? 10 : 0 }}>{line || " "}</AppText>;
              })}
            </View>
          </ScrollView>
        </ScrollView>}
  </View>;
}
