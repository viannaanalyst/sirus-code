import { useRoute, type RouteProp } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../components/AppText";
import { useSirus } from "../data/store";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { resolveNativeTerminalSurfaceView } from "../features/terminal/nativeTerminalModule";
import { buildGhosttyThemeConfig, getMobileTerminalTheme } from "../features/terminal/terminalTheme";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../native/StackHeader";

type TerminalParams = { Terminal: { computerId: string; sessionId: string } };

/** Output kept for the surface; past it the oldest half is dropped and the surface redraws. */
const MAX_BUFFER = 400_000;

const KEYS: { label: string; data: string }[] = [
  { label: "esc", data: "\u001b" },
  { label: "tab", data: "\t" },
  { label: "ctrl-C", data: "\u0003" },
  { label: "ctrl-D", data: "\u0004" },
  { label: "←", data: "\u001b[D" },
  { label: "↑", data: "\u001b[A" },
  { label: "↓", data: "\u001b[B" },
  { label: "→", data: "\u001b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
];

/**
 * A shell in the conversation's folder on its computer, drawn by the native Ghostty
 * surface. Output arrives through `pty-output`; keys go back with `write_terminal`. A key row
 * rides the keyboard with what the iPhone keyboard lacks (esc, tab, ctrl, arrows).
 */
export function TerminalScreen() {
  const { computerId, sessionId } = useRoute<RouteProp<TerminalParams, "Terminal">>().params;
  const insets = useSafeAreaInsets();
  const { themeAppearance, themeId, appearance } = useAppearancePreferences();
  const theme = getMobileTerminalTheme(themeId, themeAppearance);
  const Surface = resolveNativeTerminalSurfaceView();
  const terminalId = useRef(`phone-${sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`).current;
  const [buffer, setBuffer] = useState("");
  const [running, setRunning] = useState(false);
  const [focus, setFocus] = useState(1);
  const started = useRef(false);
  const size = useRef({ cols: 80, rows: 24 });
  const invoke = useCallback(<T,>(command: string, args: Record<string, unknown>) => useSirus.getState().invoke<T>(computerId, command, args), [computerId]);

  useEffect(() => {
    const transport = useSirus.getState().transportFor(computerId);
    if (!transport) return;
    let disposed = false;
    const offs: Promise<() => void>[] = [
      transport.listen<{ sessionId: string; terminalId: string; data: string }>("pty-output", (event) => {
        if (disposed || event.terminalId !== terminalId) return;
        setBuffer((current) => {
          const next = current + event.data;
          return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER / 2) : next;
        });
      }),
      transport.listen<{ sessionId: string; terminalId: string }>("pty-exit", (event) => {
        if (!disposed && event.terminalId === terminalId) setRunning(false);
      }),
    ];
    return () => {
      disposed = true;
      offs.forEach((off) => void off.then((unlisten) => unlisten()));
    };
  }, [computerId, terminalId]);

  const start = useCallback(async () => {
    started.current = true;
    try {
      await invoke<void>("start_terminal", { sessionId, terminalId, cols: size.current.cols, rows: size.current.rows });
      setRunning(true);
    } catch (reason) {
      started.current = false;
      setBuffer((current) => `${current}\r\n\u001b[31m${reason instanceof Error ? reason.message : String(reason)}\u001b[0m\r\n`);
    }
  }, [invoke, sessionId, terminalId]);

  const onResize = useCallback((cols: number, rows: number) => {
    size.current = { cols, rows };
    if (!started.current) void start();
    else void invoke<void>("resize_terminal", { sessionId, terminalId, cols, rows }).catch(() => undefined);
  }, [invoke, sessionId, start, terminalId]);

  const write = useCallback((data: string) => {
    if (running) void invoke<void>("write_terminal", { sessionId, terminalId, data }).catch(() => undefined);
  }, [invoke, running, sessionId, terminalId]);

  const restart = () => {
    setBuffer("");
    void invoke<void>("stop_terminal", { sessionId, terminalId }).catch(() => undefined).then(() => start());
  };
  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) write(text);
  };

  return <View className="flex-1" style={{ backgroundColor: theme.background }}>
    <NativeStackScreenOptions options={{ title: "Terminal", unstable_headerSubtitle: running ? "rodando" : "parado" }} optionsVersion={[running]} />
    <NativeHeaderToolbar placement="right">
      <NativeHeaderToolbar.Menu accessibilityLabel="Mais" icon="ellipsis">
        <NativeHeaderToolbar.MenuAction icon="doc.on.clipboard" onPress={() => void paste()}>
          <NativeHeaderToolbar.Label>Colar</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="keyboard" onPress={() => setFocus((value) => value + 1)}>
          <NativeHeaderToolbar.Label>Mostrar teclado</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
        <NativeHeaderToolbar.MenuAction icon="arrow.clockwise" onPress={restart}>
          <NativeHeaderToolbar.Label>Reiniciar shell</NativeHeaderToolbar.Label>
        </NativeHeaderToolbar.MenuAction>
      </NativeHeaderToolbar.Menu>
    </NativeHeaderToolbar>
    <View style={{ flex: 1, paddingTop: insets.top + 52, paddingBottom: 52 + insets.bottom, paddingHorizontal: 6 }}>
      {Surface
        ? <Surface style={{ flex: 1 }} terminalKey={terminalId} initialBuffer={buffer} fontSize={appearance.terminalFontSize}
            appearanceScheme={themeAppearance} autoFocus focusRequest={running ? focus : 0} readOnly={false}
            backgroundColor={theme.background} foregroundColor={theme.foreground} mutedForegroundColor={theme.mutedForeground}
            themeConfig={buildGhosttyThemeConfig(theme)}
            onInput={(event) => write(event.nativeEvent.data)}
            onResize={(event) => onResize(event.nativeEvent.cols, event.nativeEvent.rows)} />
        : <AppText className="m-4 text-sm text-foreground-muted">O terminal nativo não está nesta versão do app.</AppText>}
    </View>
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      <View style={{ paddingBottom: insets.bottom, backgroundColor: theme.background }}>
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-2 py-2">
          {KEYS.map((key) => <Pressable key={key.label} disabled={!running} onPress={() => { void Haptics.selectionAsync(); write(key.data); }}
            className="h-9 min-w-[44px] items-center justify-center rounded-lg bg-card px-3 active:opacity-60 disabled:opacity-40">
            <AppText className="font-app-medium text-sm">{key.label}</AppText>
          </Pressable>)}
        </ScrollView>
      </View>
    </KeyboardStickyView>
  </View>;
}
