import { useNavigation, useRoute, type NavigationProp, type ParamListBase, type RouteProp } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { SymbolView } from "../components/AppSymbol";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, LayoutAnimation, Pressable, ScrollView, View } from "react-native";
import { KeyboardStickyView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Message, PromptAttachment } from "@sirus/client/types";

import { AppText, AppTextInput } from "../components/AppText";
import { ComposerSend } from "../components/ComposerSend";
import { ProviderIcon } from "../components/ProviderIcon";
import { ControlPillMenu } from "../components/ControlPillMenu";
import { GlassSurface } from "../components/GlassSurface";
import { AgentReply, type ReplyFiles } from "../components/AgentReply";
import { AgentRequest, PromptQueue } from "../components/AgentRequest";
import { UserText } from "../components/UserText";
import { useConversationModel } from "../data/conversation-model";
import { attachmentOwner, pickAttachments, releaseAttachments, uploadAttachments } from "../data/attachments";
import { isScratch, projectLabel } from "../data/scratch";
import { ACTIVE_STATUS, transcriptKey, useSirus, type QueuedPrompt } from "../data/store";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";

type ThreadParams = { Thread: { computerId: string; sessionId: string } };

const NO_QUEUE: QueuedPrompt[] = [];

/**
 * A conversation: the native glass header (back, title and project, then the
 * terminal, files and Git controls with iOS menus), the transcript, and the glass composer that
 * rides the keyboard.
 */
export function ThreadScreen() {
  const { computerId, sessionId } = useRoute<RouteProp<ThreadParams, "Thread">>().params;
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const session = useSirus((state) => state.data[computerId]?.sessions.find((item) => item.id === sessionId));
  const project = useSirus((state) => state.data[computerId]?.projects.find((item) => item.id === session?.projectId));
  const messages = useSirus((state) => state.transcripts[transcriptKey(computerId, sessionId)]);
  const queued = useSirus((state) => state.queue[transcriptKey(computerId, sessionId)] ?? NO_QUEUE);
  // Older messages load a page at a time as the top comes near (the first page is the newest).
  const olderLeft = useSirus((state) => (state.transcriptStart[transcriptKey(computerId, sessionId)] ?? 0) > 0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = () => {
    if (!olderLeft || loadingOlder) return;
    setLoadingOlder(true);
    void useSirus.getState().loadOlder(computerId, sessionId).catch(() => false).finally(() => setLoadingOlder(false));
  };
  const list = useRef<FlatList<Message>>(null);
  const safeArea = useSafeAreaInsets();
  // The native scroll view's own end: FlatList's `scrollToEnd` uses cell sizes measured before
  // the native markdown grew.
  const toEnd = (animated = false) => (list.current?.getNativeScrollRef() as { scrollToEnd?: (options: { animated: boolean }) => void } | null)?.scrollToEnd?.({ animated });
  // Away from the end, a round arrow brings the newest message back (as the desktop's).
  const [away, setAway] = useState(false);
  // The list ends above the composer and, while it is open, above the keyboard too.
  const [composerHeight, setComposerHeight] = useState(96);
  const keyboardHeight = useKeyboardState((state) => state.isVisible ? state.height : 0);
  const lift = keyboardHeight ? Math.max(keyboardHeight - safeArea.bottom + 8, 0) : 0;
  const atEnd = useRef(true);
  const dragging = useRef(false);

  useEffect(() => {
    void useSirus.getState().loadTranscript(computerId, sessionId).catch(() => undefined);
  }, [computerId, sessionId]);
  // Opening the keyboard at the newest message keeps it in view above the composer.
  useEffect(() => {
    if (!lift || !atEnd.current) return;
    const timer = setTimeout(() => toEnd(true), 30);
    return () => clearTimeout(timer);
  }, [lift]);

  const shown = useMemo(() => (messages ?? []).filter((message) => message.role !== "system" && (message.content.trim() || message.streaming)), [messages]);
  // Native markdown measures after the first layout, so the opening lands on the end again
  // a few times while it settles, unless the person already scrolled.
  const loaded = messages !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const timers = [60, 250, 600, 1200, 2000].map((delay) => setTimeout(() => { if (!dragging.current) toEnd(); }, delay));
    return () => timers.forEach(clearTimeout);
  }, [loaded, sessionId]);
  const working = session ? ACTIVE_STATUS.has(session.status) : false;
  const cwd = session?.worktree?.path ?? project?.path;
  // File references in replies open in the conversation's files.
  const openFile = useCallback((path: string) => navigation.navigate("File", { computerId, sessionId, path }), [navigation, computerId, sessionId]);
  const files = useMemo<ReplyFiles | undefined>(() => cwd ? { cwd, open: openFile } : undefined, [cwd, openFile]);
  const requests = session?.pendingRequests ?? [];
  const subtitle = [projectLabel(project), isScratch(project) ? null : session?.worktree?.branch].filter(Boolean).join(" · ");

  return <View className="flex-1 bg-thread-canvas">
    <NativeStackScreenOptions options={{ title: session?.title || "Conversa", unstable_headerSubtitle: subtitle }} optionsVersion={[session?.title, subtitle]} />
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Button accessibilityLabel="Terminal" icon="terminal" onPress={() => navigation.navigate("Terminal", { computerId, sessionId })} />
      <NativeHeaderToolbar.Button accessibilityLabel="Arquivos" icon="folder" onPress={() => navigation.navigate("Files", { computerId, sessionId, title: project?.name })} />
      <NativeHeaderToolbar.Menu accessibilityLabel="Git" icon="point.topleft.down.curvedto.point.bottomright.up">
        <NativeHeaderToolbar.MenuAction icon="arrow.triangle.branch" disabled onPress={() => {}} subtitle={project?.name ?? ""}>
          <NativeHeaderToolbar.Label>{session?.worktree?.branch ?? "—"}</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="doc.text.magnifyingglass" onPress={() => navigation.navigate("Git", { computerId, sessionId })}>
          <NativeHeaderToolbar.Label>Alterações e commit</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar>
    {messages === undefined ? <ActivityIndicator className="mt-24" /> : <FlatList
      ref={list}
      className="flex-1"
      // Insets of its own: `scrollToEnd` leaves out the ones iOS adds by itself.
      contentInsetAdjustmentBehavior="never"
      // scrolling the conversation puts the keyboard away, and the composer folds back.
      keyboardDismissMode="on-drag"
      // A page added above keeps what is on screen in place.
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      ListHeaderComponent={loadingOlder ? <ActivityIndicator className="py-2" /> : undefined}
      data={shown}
      keyExtractor={(message) => message.id}
      renderItem={({ item }) => <MessageRow message={item} agent={session?.agent ?? "claude"} cwd={cwd} files={files} />}
      // The agent waiting on an approval or an answer, as the desktop's cards under the reply.
      ListFooterComponent={requests.length ? <View className="gap-3">
        {requests.map((request) => <AgentRequest key={request.requestId} computerId={computerId} sessionId={sessionId} agent={session?.agent ?? "claude"} request={request} />)}
      </View> : undefined}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: safeArea.top + 44 + 8, paddingBottom: composerHeight + lift + 12, gap: 18 }}
      // Follows new content while the newest message is in view; a drag up stops it.
      onContentSizeChange={() => { if (atEnd.current) toEnd(); }}
      onScrollBeginDrag={() => { dragging.current = true; }}
      onScroll={({ nativeEvent }) => {
        if (dragging.current && nativeEvent.contentOffset.y < nativeEvent.layoutMeasurement.height * 1.5) loadOlder();
        const near = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 160;
        if (dragging.current) atEnd.current = near;
        const far = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height < nativeEvent.contentSize.height - 400;
        if (far !== away) setAway(far);
      }}
      scrollEventThrottle={64}
    />}
    <Composer computerId={computerId} sessionId={sessionId} working={working} onHeight={setComposerHeight} agent={session?.agent ?? "claude"} queued={queued}
      away={away} onJump={() => { atEnd.current = true; dragging.current = false; setAway(false); toEnd(true); }} />
  </View>;
}

const MessageRow = memo(function MessageRow(props: { readonly message: Message; readonly agent: string; readonly cwd?: string; readonly files?: ReplyFiles }) {
  if (props.message.role === "user") {
    return <View className="max-w-[85%] self-end rounded-3xl bg-card px-4 py-2.5">
      <UserText text={props.message.content} />
    </View>;
  }
  return <AgentReply message={props.message} agent={props.agent} cwd={props.cwd} files={props.files} />;
});

/** The glass composer: attachments, the field, dictation, and send or stop. */
function Composer(props: {
  readonly computerId: string; readonly sessionId: string; readonly working: boolean;
  readonly agent: string;
  /** Messages waiting for the reply to end; they show above the composer. */
  readonly queued: QueuedPrompt[];
  /** The composer's height, for the list to keep its last message above it. */
  readonly onHeight: (height: number) => void;
  /** Away from the newest message: the round arrow rides just above the composer. */
  readonly away: boolean; readonly onJump: () => void;
}) {
  const insets = useSafeAreaInsets();
  const owner = attachmentOwner(props.sessionId);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const returnSends = useSirus((state) => state.prefs.returnKey === "send");
  const [busy, setBusy] = useState<"sending" | "attaching" | null>(null);
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !busy;
  const { execution } = useConversationModel(props.computerId, props.sessionId);
  const [focused, setFocused] = useState(false);
  const submit = async () => {
    if (!canSend) return;
    setBusy("sending");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      // While the agent works it joins the queue and goes once the reply ends.
      await useSirus.getState().submitPrompt(props.computerId, props.sessionId, text, attachments.map((item) => item.id), execution);
      setText("");
      setAttachments([]);
    } catch (reason) {
      Alert.alert("Não foi possível enviar", reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };
  const attach = async (kind: "photos" | "files") => {
    try {
      const files = await pickAttachments(kind);
      if (!files.length) return;
      setBusy("attaching");
      const added = await uploadAttachments(props.computerId, owner, files.slice(0, Math.max(0, 8 - attachments.length)));
      setAttachments((current) => [...current, ...added]);
    } catch (reason) {
      Alert.alert("Anexos", reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  };
  const remove = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
    void releaseAttachments(props.computerId, owner, [id]);
  };
  const stop = () => void useSirus.getState().stopAgent(props.computerId, props.sessionId).catch(() => undefined);
  // one row at rest; focused (or holding text), the field takes the top and the
  // controls sit below it, the model button among them.
  const expanded = focused || text.length > 0 || attachments.length > 0;
  const setFocus = (value: boolean) => { LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity")); setFocused(value); };
  const plus = <ControlPillMenu actions={[{ id: "photos", title: "Fotos", image: "photo" }, { id: "files", title: "Escolher arquivos", image: "folder" }]}
    onPressAction={({ nativeEvent }) => void attach(nativeEvent.event as "photos" | "files")} accessibilityLabel="Anexar">
    <View className="size-[38px] items-center justify-center"><SymbolView name="plus" size={20} tintColorClassName="accent-icon" /></View>
  </ControlPillMenu>;
  const send = <ComposerSend text={text} onTextChange={setText} onSend={() => void submit()} sending={busy === "sending"} canSend={canSend}
    onStop={props.working && !attachments.length ? stop : undefined} disabled={busy === "attaching"} />;
  const field = <AppTextInput value={text} onChangeText={setText} placeholder="Pergunte ao agente…" multiline onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
    {...(returnSends ? { submitBehavior: "submit" as const, returnKeyType: "send" as const, onSubmitEditing: () => void submit() } : {})}
    className={expanded ? "max-h-40 min-h-[64px] rounded-none border-0 bg-transparent px-2 pb-1 pt-2 text-base" : "max-h-32 min-h-[38px] rounded-none border-0 bg-transparent px-1 py-2 text-base"} />;
  return <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom - 8 }} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
    {props.away ? <Pressable onPress={props.onJump} accessibilityLabel="Ir para a última mensagem" style={{ position: "absolute", top: -52, alignSelf: "center" }}>
      <GlassSurface style={{ borderRadius: 20 }} className="size-10 items-center justify-center">
        <SymbolView name="arrow.down" size={16} weight="semibold" tintColorClassName="accent-foreground" />
      </GlassSurface>
    </Pressable> : null}
    <View style={{ paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 12) }} onLayout={(event) => props.onHeight(Math.round(event.nativeEvent.layout.height))}>
      {props.queued.length ? <PromptQueue computerId={props.computerId} sessionId={props.sessionId} agent={props.agent} items={props.queued} /> : null}
      <GlassSurface style={{ borderRadius: 26 }} className="px-1.5 py-1.5">
        {attachments.length || busy === "attaching" ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerClassName="gap-1.5 px-1.5 pb-1 pt-1">
          {attachments.map((item) => <View key={item.id} className="h-8 max-w-[180px] flex-row items-center gap-1.5 rounded-full bg-card pl-2.5 pr-1">
            <SymbolView name={item.mimeType?.startsWith("image/") ? "photo" : "doc"} size={12} tintColorClassName="accent-foreground-muted" />
            <AppText numberOfLines={1} className="shrink text-xs">{item.name}</AppText>
            <Pressable onPress={() => remove(item.id)} hitSlop={8} accessibilityLabel={`Remover ${item.name}`} className="size-6 items-center justify-center rounded-full active:bg-row-hover">
              <SymbolView name="xmark" size={9} weight="semibold" tintColorClassName="accent-foreground-muted" />
            </Pressable>
          </View>)}
          {busy === "attaching" ? <View className="h-8 justify-center px-2"><ActivityIndicator size="small" /></View> : null}
        </ScrollView> : null}
        {/* The field keeps its place in the tree whether the composer is one row or grown, so
            growing on focus never remounts it (which would drop the focus and the keyboard). */}
        <View className="flex-row items-end gap-1">
          {expanded ? null : plus}
          <View className="min-w-0 flex-1">{field}</View>
          {expanded ? null : <View className="h-[38px] justify-center pr-1">{send}</View>}
        </View>
        {expanded ? <View className="flex-row items-center gap-1">
          {plus}
          <View className="flex-1" />
          <ModelButton computerId={props.computerId} sessionId={props.sessionId} />
          <View className="pr-1">{send}</View>
        </View> : null}
      </GlassSurface>
    </View>
  </KeyboardStickyView>;
}

/** The conversation's model in the composer; it opens the conversation's settings sheet. */
function ModelButton(props: { readonly computerId: string; readonly sessionId: string }) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { provider, name } = useConversationModel(props.computerId, props.sessionId);
  return <Pressable onPress={() => navigation.navigate("ThreadSettings", { computerId: props.computerId, sessionId: props.sessionId })} accessibilityLabel={`Modelo: ${name}`}
    className="h-[38px] max-w-[190px] flex-row items-center gap-1.5 rounded-full px-2.5 active:bg-row-hover">
    <ProviderIcon provider={provider} size={16} />
    <AppText numberOfLines={1} className="shrink font-app-medium text-sm">{name}</AppText>
    <SymbolView name="chevron.down" size={10} weight="semibold" tintColorClassName="accent-foreground-muted" />
  </Pressable>;
}
