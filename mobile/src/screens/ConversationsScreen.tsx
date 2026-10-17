import { useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";

import { SymbolView } from "../components/AppSymbol";
import { AppText } from "../components/AppText";
import { SegmentedControl } from "../components/SegmentedControl";
import { ThreadRow } from "../components/ThreadRow";
import { computerName } from "../data/computers";
import { useSirus } from "../data/store";
import { useConversationRows, type ConversationRow } from "../data/use-conversations";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";
import { useMainTabs, type ConversationFilter } from "./main-tabs-context";

const FILTERS: readonly { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "attention", label: "Atenção" },
  { id: "working", label: "Trabalhando" },
  { id: "review", label: "Prontas" },
];

const EMPTY: Record<ConversationFilter, string> = {
  all: "Nenhuma conversa ainda.",
  attention: "Nada esperando por você.",
  working: "Nenhum agente trabalhando agora.",
  review: "Nada terminou nas últimas 24 horas.",
};

function matches(row: ConversationRow, needle: string) {
  return !needle || row.session.title.toLocaleLowerCase().includes(needle) || (row.project?.name ?? "").toLocaleLowerCase().includes(needle);
}

/**
 * Conversas: every computer's conversations in one list, a native segmented control for what
 * waits on the person, works or is ready, and a menu for the computer and the project. In
 * `search` mode (the tab bar's search button) it is the search over every conversation.
 */
export function ConversationsScreen(props: { readonly mode?: "tab" | "search" }) {
  const search = props.mode === "search";
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const tabs = useMainTabs();
  const [localFilter, setLocalFilter] = useState<ConversationFilter>("all");
  const filter = search ? "all" : tabs?.filter ?? localFilter;
  const setFilter = tabs?.setFilter ?? setLocalFilter;
  const computers = useSirus((state) => state.computers);
  const data = useSirus((state) => state.data);
  const [query, setQuery] = useState("");
  const [computerFilter, setComputerFilter] = useState<string | null>(null);
  /** `computerId:projectId`. */
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const rows = useConversationRows();
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => (filter === "all" || row.bucket === filter)
      && (!computerFilter || row.computerId === computerFilter)
      && (!projectFilter || `${row.computerId}:${row.session.projectId}` === projectFilter)
      && matches(row, needle));
  }, [rows, filter, query, computerFilter, projectFilter]);
  const several = computers.length > 1;
  const loading = computers.some((computer) => !data[computer.id]) && !rows.length;

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (row.project && (!computerFilter || row.computerId === computerFilter)) seen.set(`${row.computerId}:${row.project.id}`, row.project.name);
    return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, computerFilter]);
  const projectName = projects.find((project) => project.key === projectFilter)?.label;
  const computerLabel = computerFilter ? computerName(computers.find((computer) => computer.id === computerFilter) ?? { hostName: "", kind: "mac" }) : null;

  const open = (row: ConversationRow) => navigation.navigate("Thread", { computerId: row.computerId, sessionId: row.session.id });
  const header = search ? null : <View className="gap-3 px-4 pb-2 pt-2">
    <SegmentedControl
      options={FILTERS.map((item) => ({ value: item.id, label: item.label }))}
      selected={filter}
      onSelect={(value) => {
        void Haptics.selectionAsync().catch(() => undefined);
        setFilter(value);
      }}
    />
    {computerLabel || projectName ? <View className="flex-row flex-wrap gap-2">
      {computerLabel ? <FilterChip icon="laptopcomputer" label={computerLabel} onClear={() => { setComputerFilter(null); setProjectFilter(null); }} /> : null}
      {projectName ? <FilterChip icon="folder" label={projectName} onClear={() => setProjectFilter(null)} /> : null}
    </View> : null}
  </View>;

  return <>
    <NativeStackScreenOptions
      optionsVersion={[search]}
      options={search ? {
        title: "Buscar",
        headerSearchBarOptions: { autoFocus: true, autoCapitalize: "none", placeholder: "Conversas e projetos", onChangeText: (event) => setQuery(event.nativeEvent.text), onCancelButtonPress: () => navigation.goBack() },
      } : { title: "Conversas", headerTitle: undefined, headerSearchBarOptions: undefined, unstable_headerLeftItems: () => [] }}
    />
    {search ? null : <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Menu accessibilityLabel="Filtrar" icon={computerFilter || projectFilter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease"}>
        <NativeHeaderToolbar.Menu title="Computador" icon="laptopcomputer">
          <NativeHeaderToolbar.Menu.Action isOn={computerFilter === null} onPress={() => setComputerFilter(null)}>Todos os computadores</NativeHeaderToolbar.Menu.Action>
          {computers.map((computer) => <NativeHeaderToolbar.Menu.Action key={computer.id} isOn={computerFilter === computer.id}
            onPress={() => { setComputerFilter(computer.id); setProjectFilter((current) => current?.startsWith(`${computer.id}:`) ? current : null); }}>{computerName(computer)}</NativeHeaderToolbar.Menu.Action>)}
        </NativeHeaderToolbar.Menu>
        {projects.length ? <NativeHeaderToolbar.Menu title="Projeto" icon="folder">
          <NativeHeaderToolbar.Menu.Action isOn={projectFilter === null} onPress={() => setProjectFilter(null)}>Todos os projetos</NativeHeaderToolbar.Menu.Action>
          {projects.map((project) => <NativeHeaderToolbar.Menu.Action key={project.key} isOn={projectFilter === project.key} onPress={() => setProjectFilter(project.key)}>{project.label}</NativeHeaderToolbar.Menu.Action>)}
        </NativeHeaderToolbar.Menu> : null}
      </NativeHeaderToolbar.Menu>
      <NativeHeaderToolbar.Button accessibilityLabel="Nova conversa" icon="square.and.pencil" onPress={() => navigation.navigate("NewThread")} />
    </NativeHeaderToolbar>}
    <FlatList
      className="flex-1 bg-thread-canvas"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      data={shown}
      keyExtractor={(row) => `${row.computerId}:${row.session.id}`}
      ListHeaderComponent={header ?? undefined}
      ListEmptyComponent={loading ? <ActivityIndicator className="mt-16" /> : <EmptyState text={query ? "Nada encontrado." : search ? "Busque pelo título da conversa ou pelo projeto." : EMPTY[filter]} />}
      renderItem={({ item, index }) => <ThreadRow row={item} separated={index > 0}
        computerLabel={several ? computerName(computers.find((computer) => computer.id === item.computerId) ?? { hostName: "", kind: "mac" }) : null}
        onPress={() => open(item)} />}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  </>;
}

function FilterChip(props: { readonly icon: string; readonly label: string; readonly onClear: () => void }) {
  return <Pressable onPress={props.onClear} accessibilityRole="button" accessibilityLabel={`Remover filtro ${props.label}`}
    className="flex-row items-center gap-1.5 rounded-full border-continuous bg-grouped-card px-3 py-1.5 active:opacity-70">
    <SymbolView name={props.icon as never} size={12} tintColorClassName="accent-foreground-muted" />
    <AppText className="font-app-medium text-sm">{props.label}</AppText>
    <SymbolView name="xmark" size={10} weight="bold" tintColorClassName="accent-foreground-tertiary" />
  </Pressable>;
}

export function EmptyState(props: { readonly text: string; readonly icon?: string }) {
  return <View className="mt-20 items-center gap-3 px-10">
    <SymbolView name={(props.icon ?? "bubble.left.and.bubble.right") as never} size={34} weight="light" tintColorClassName="accent-foreground-tertiary" />
    <AppText className="text-center text-sm text-foreground-muted">{props.text}</AppText>
  </View>;
}

/** The search over every conversation, opened by the tab bar's search button. */
export function SearchScreen() {
  return <ConversationsScreen mode="search" />;
}
