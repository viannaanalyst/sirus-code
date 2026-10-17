import { useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { AgentRequest } from "../components/AgentRequest";
import { SymbolView, type AppSymbolName } from "../components/AppSymbol";
import { AppText } from "../components/AppText";
import { ListSection } from "../components/ListSection";
import { ThreadRow } from "../components/ThreadRow";
import { computerName } from "../data/computers";
import { isScratch } from "../data/scratch";
import { useSirus } from "../data/store";
import { bucketCounts, useConversationRows } from "../data/use-conversations";
import SIRUS_GLYPH from "../../assets/sirus-glyph.png";
import { useUniwindTheme } from "../lib/useUniwindTheme";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";
import { useMainTabs, type ConversationFilter } from "./main-tabs-context";

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const HOURS = 12;
const SPRING = { damping: 18, stiffness: 320, mass: 0.6 };

function greeting(now: Date) {
  const hour = now.getHours();
  const part = hour < 5 ? "Boa noite" : hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return { part, date: `${WEEKDAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]}` };
}

/**
 * Início: what needs the person first. Four cards (waiting on you, working, ready, projects)
 * that open Conversas filtered or Projetos, the day in one sentence with the last hours'
 * activity, the approvals and questions answerable right here, and the latest conversations.
 */
export function HomeScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const tabs = useMainTabs();
  const theme = useUniwindTheme();
  const computers = useSirus((state) => state.computers);
  const connection = useSirus((state) => state.connection);
  const data = useSirus((state) => state.data);
  const rows = useConversationRows();
  const counts = useMemo(() => bucketCounts(rows), [rows]);
  const projects = useMemo(() => Object.values(data).reduce((sum, value) => sum + value.projects.filter((project) => !isScratch(project)).length, 0), [data]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);

  const attention = rows.filter((row) => row.bucket === "attention");
  const requests = attention.flatMap((row) => (row.session.pendingRequests ?? []).map((request) => ({ row, request }))).slice(0, 3);
  const waitingRows = attention.filter((row) => !row.session.pendingRequests?.length);
  const recent = rows.filter((row) => row.bucket !== "attention").slice(0, 5);

  // Today in one sentence, and how many conversations moved in each of the last hours.
  const today = rows.filter((row) => new Date(row.session.lastActivityAt).toDateString() === now.toDateString());
  const todayProjects = new Set(today.map((row) => `${row.computerId}:${row.session.projectId}`)).size;
  const bars = useMemo(() => {
    const counts = Array.from({ length: HOURS }, () => 0);
    for (const row of rows) {
      const hoursAgo = Math.floor((now.getTime() - Date.parse(row.session.lastActivityAt)) / 3_600_000);
      if (hoursAgo >= 0 && hoursAgo < HOURS) counts[HOURS - 1 - hoursAgo]! += 1;
    }
    return counts;
  }, [rows, now]);
  const peak = Math.max(1, ...bars);

  // Out of reach means the socket gave up ("lost") or the token was refused; connecting is not offline.
  const online = computers.filter((computer) => connection[computer.id] === "open");
  const away = computers.filter((computer) => connection[computer.id] === "lost" || connection[computer.id] === "unauthorized");
  const status = !computers.length ? ""
    : away.length ? (away.length === 1 ? `${computerName(away[0]!)} fora do ar` : `${away.length} computadores fora do ar`) + (online.length ? ` · ${online.length} conectado${online.length > 1 ? "s" : ""}` : "")
    : online.length === computers.length ? computers.length === 1 ? `${computerName(computers[0]!)} · conectado` : `${computers.length} computadores conectados`
    : "Conectando…";

  const openFilter = (filter: ConversationFilter) => tabs?.open("conversations", filter);
  const thread = (computerId: string, sessionId: string) => navigation.navigate("Thread", { computerId, sessionId });

  return <>
    <NativeStackScreenOptions
      optionsVersion={[theme["--color-foreground"]]}
      options={{
        title: "Início",
        headerSearchBarOptions: undefined,
        unstable_headerLeftItems: () => [],
        headerTitle: () => <View className="flex-row items-center gap-2">
          <Image source={SIRUS_GLYPH} style={{ width: 22, height: 22, tintColor: theme["--color-foreground"] }} />
          <AppText className="font-app-bold text-[18px]">Sirus</AppText>
        </View>,
      }}
    />
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Button accessibilityLabel="Nova conversa" icon="square.and.pencil" onPress={() => navigation.navigate("NewThread")} />
    </NativeHeaderToolbar>
    <ScrollView className="flex-1 bg-screen" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-4 pb-10 pt-2">
      <View className="gap-1.5 px-1">
        <AppText className="font-app-bold text-3xl">{greeting(now).part}</AppText>
        <AppText className="text-sm text-foreground-muted">{greeting(now).date}</AppText>
        {status ? <View className="flex-row items-center gap-1.5">
          <View className={`size-2 rounded-full ${away.length === computers.length ? "bg-danger-foreground" : away.length || online.length < computers.length ? "bg-adaptive-amber-700-400" : "bg-adaptive-emerald-600-400"}`} />
          <AppText className="text-sm text-foreground-muted">{status}</AppText>
        </View> : null}
      </View>

      <View className="gap-2.5">
        <View className="flex-row gap-2.5">
          <Tile icon="exclamationmark.shield.fill" tint="#f0a35e" value={counts.attention} label="Precisa de você" onPress={() => openFilter("attention")} highlight={counts.attention > 0} />
          <Tile icon="circle.dashed" tint="#5ab8ff" value={counts.working} label="Trabalhando" onPress={() => openFilter("working")} />
        </View>
        <View className="flex-row gap-2.5">
          <Tile icon="checkmark.circle.fill" tint="#4cc06c" value={counts.review} label="Prontas hoje" onPress={() => openFilter("review")} />
          <Tile icon="folder.fill" tint="#a3a8ff" value={projects} label="Projetos" onPress={() => tabs?.open("projects")} />
        </View>
      </View>

      <View className="gap-3 rounded-[24px] border-continuous bg-grouped-card px-4 py-3.5">
        <View className="flex-row items-center justify-between">
          <AppText className="text-xs font-app-medium text-foreground-muted">Seu dia</AppText>
          <AppText className="text-xs text-foreground-tertiary">últimas {HOURS} horas</AppText>
        </View>
        <AppText className="text-base leading-6 text-foreground-secondary">
          {today.length
            ? <>Hoje você mexeu em <AppText className="font-app-bold text-foreground">{today.length} {today.length === 1 ? "conversa" : "conversas"}</AppText> em <AppText className="font-app-bold text-foreground">{todayProjects} {todayProjects === 1 ? "projeto" : "projetos"}</AppText>{counts.working ? <>, e <AppText className="font-app-bold text-foreground">{counts.working} {counts.working === 1 ? "agente está" : "agentes estão"}</AppText> trabalhando agora</> : null}.</>
            : "Nenhuma conversa hoje ainda. Toque no lápis para começar."}
        </AppText>
        <View className="h-9 flex-row items-end gap-1">
          {bars.map((count, index) => <View key={index} className={`flex-1 rounded-[3px] ${count ? "bg-adaptive-sky-600-400" : "bg-adaptive-neutral-950-a10-white-a10"}`}
            style={{ height: count ? 8 + (count / peak) * 28 : 4, opacity: count ? 0.55 + (index / HOURS) * 0.45 : 1 }} />)}
        </View>
      </View>

      {attention.length ? <Animated.View layout={LinearTransition.springify().damping(20)} className="gap-2.5">
        <SectionHeader title="Precisa de você" count={attention.length} action={attention.length > requests.length ? { label: "Ver tudo", onPress: () => openFilter("attention") } : undefined} />
        {requests.map(({ row, request }) => <Animated.View key={`${row.computerId}:${row.session.id}:${request.requestId}`} entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} layout={LinearTransition.springify().damping(20)}
          className="overflow-hidden rounded-[24px] border-continuous bg-grouped-card">
          <Pressable onPress={() => thread(row.computerId, row.session.id)} className="flex-row items-center gap-2 px-4 pt-3 active:opacity-70">
            <AppText numberOfLines={1} className="flex-1 font-app-bold text-sm">{row.session.title || "Nova conversa"}</AppText>
            <AppText numberOfLines={1} className="max-w-[40%] text-xs text-foreground-muted">{row.project?.name}</AppText>
            <SymbolView name="chevron.right" size={11} weight="semibold" tintColorClassName="accent-chevron" />
          </Pressable>
          <AgentRequest computerId={row.computerId} sessionId={row.session.id} agent={row.session.agent} request={request} />
        </Animated.View>)}
        {waitingRows.length && !requests.length ? <ListSection>
          {waitingRows.slice(0, 3).map((row, index) => <ThreadRow key={row.session.id} row={row} grouped separated={index > 0} computerLabel={null} onPress={() => thread(row.computerId, row.session.id)} />)}
        </ListSection> : null}
      </Animated.View> : null}

      {recent.length ? <View className="gap-2.5">
        <SectionHeader title="Recentes" action={{ label: "Ver todas", onPress: () => openFilter("all") }} />
        <ListSection>
          {recent.map((row, index) => <ThreadRow key={`${row.computerId}:${row.session.id}`} row={row} grouped separated={index > 0} computerLabel={null} onPress={() => thread(row.computerId, row.session.id)} />)}
        </ListSection>
      </View> : null}
    </ScrollView>
  </>;
}

function SectionHeader(props: { readonly title: string; readonly count?: number; readonly action?: { label: string; onPress: () => void } }) {
  return <View className="flex-row items-center gap-1.5 px-2">
    <AppText className="text-sm font-app-medium text-foreground-muted">{props.title}</AppText>
    {props.count ? <AppText className="text-sm text-foreground-tertiary">{props.count}</AppText> : null}
    <View className="flex-1" />
    {props.action ? <Pressable onPress={props.action.onPress} hitSlop={8} className="active:opacity-60">
      <AppText className="text-sm font-app-medium text-adaptive-blue-600-400">{props.action.label}</AppText>
    </Pressable> : null}
  </View>;
}

/** A counter card: the number large, its label below; it presses in with a spring and a tick. */
function Tile(props: { readonly icon: string; readonly tint: string; readonly value: number; readonly label: string; readonly highlight?: boolean; readonly onPress: () => void }) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[{ flex: 1 }, style]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${props.label}: ${props.value}`}
      onPressIn={() => { scale.value = withSpring(0.96, SPRING); }}
      onPressOut={() => { scale.value = withSpring(1, SPRING); }}
      onPress={() => { void Haptics.selectionAsync().catch(() => undefined); props.onPress(); }}
      className="h-[92px] justify-between rounded-[22px] border-continuous bg-grouped-card px-3.5 py-3"
      style={props.highlight ? { borderWidth: 1, borderColor: `${props.tint}66`, backgroundColor: `${props.tint}14` } : undefined}>
      <View className="flex-row items-start justify-between">
        <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: `${props.tint}22` }}>
          <SymbolView name={props.icon as AppSymbolName} size={16} weight="semibold" tintColor={props.tint} />
        </View>
        <AppText className="font-app-bold text-[26px] leading-[30px] tabular-nums">{props.value}</AppText>
      </View>
      <AppText numberOfLines={1} className="font-app-medium text-sm text-foreground-secondary">{props.label}</AppText>
    </Pressable>
  </Animated.View>;
}
