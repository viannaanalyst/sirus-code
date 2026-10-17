import { Pressable, View } from "react-native";
import { ScopedTheme, ScopedVariables } from "uniwind";

import { AppText as Text } from "../../../../components/AppText";
import { type MobileThemeIds, type MobileThemeMode } from "../../../../lib/mobileTheme";
import { getMobileUniwindThemeName } from "../../../../lib/mobileThemeRuntime";
import { cn } from "../../../../lib/cn";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

const APPEARANCE_MODES: ReadonlyArray<{
  readonly id: MobileThemeMode;
  readonly label: string;
}> = [
  { id: "system", label: "Sistema" },
  { id: "light", label: "Claro" },
  { id: "dark", label: "Escuro" },
];


function PreviewPane(props: { readonly compact?: boolean }) {
  return (
    <View className="flex-1 overflow-hidden bg-screen">
      <View
        className={cn("bg-card", props.compact ? "h-[18px] gap-0.5 px-1" : "h-[18px] gap-1 px-1.5")}
      >
        <View className="mt-2 flex-row items-center gap-1">
          <View className="size-1.5 rounded-full bg-primary" />
          <View className="h-1 flex-1 rounded-full bg-foreground-muted" />
        </View>
      </View>
      <View
        className={
          props.compact ? "flex-1 justify-between px-1 py-2" : "flex-1 justify-between px-1.5 py-2"
        }
      >
        <View className="gap-1">
          <View className="h-1.5 w-[72%] rounded-full bg-subtle-strong" />
          <View className="h-1.5 w-[46%] rounded-full bg-subtle-strong" />
        </View>
        <View className="items-end gap-1 pb-2">
          <View className="h-3 w-[78%] rounded-full bg-user-bubble" />
          <View className="h-1 w-[38%] rounded-full bg-foreground-muted" />
        </View>
      </View>
    </View>
  );
}

function ModePreview(props: { readonly mode: MobileThemeMode; readonly themeIds: MobileThemeIds }) {
  const { themeVariablesByAppearance } = useAppearancePreferences();
  if (props.mode === "system") {
    return (
      <View className="h-24 w-14 self-center rounded-[16px] border-[1.5px] border-border bg-drawer p-[3px]">
        <View className="flex-1 flex-row overflow-hidden rounded-[11px]">
          <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds.light, "light")}>
            <ScopedVariables variables={themeVariablesByAppearance.light}>
              <PreviewPane compact />
            </ScopedVariables>
          </ScopedTheme>
          <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds.dark, "dark")}>
            <ScopedVariables variables={themeVariablesByAppearance.dark}>
              <PreviewPane compact />
            </ScopedVariables>
          </ScopedTheme>
        </View>
        <View className="absolute bottom-[6px] left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-foreground-muted" />
      </View>
    );
  }

  return (
    <ScopedTheme theme={getMobileUniwindThemeName(props.themeIds[props.mode], props.mode)}>
      <View className="h-24 w-14 self-center rounded-[16px] border-[1.5px] border-border bg-drawer p-[3px]">
        <View className="flex-1 flex-row overflow-hidden rounded-[11px]">
          <ScopedVariables variables={themeVariablesByAppearance[props.mode]}>
            <PreviewPane />
          </ScopedVariables>
        </View>
        <View className="absolute bottom-[6px] left-1/2 h-1 w-4 -translate-x-1/2 rounded-full bg-foreground-muted" />
      </View>
    </ScopedTheme>
  );
}

function ModeCard(props: {
  readonly disabled: boolean;
  readonly label: string;
  readonly mode: MobileThemeMode;
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly themeIds: MobileThemeIds;
}) {
  return (
    <Pressable
      accessibilityLabel={`${props.label} appearance`}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      className={cn(
        "min-w-0 flex-1 gap-2 rounded-[24px] p-2 active:scale-[0.97]",
        props.selected
          ? "border-2 border-primary bg-subtle"
          : "border border-border bg-grouped-card",
      )}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <ModePreview mode={props.mode} themeIds={props.themeIds} />
      <Text
        className={
          props.selected
            ? "text-center text-base font-app-bold text-foreground"
            : "text-center text-base text-foreground-muted"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function SectionLabel({ children }: { readonly children: string }) {
  return <Text className="px-2 text-sm font-app-medium text-foreground-muted">{children}</Text>;
}

export function ThemeAppearanceSection() {
  // Only the color scheme: the Sirus keeps its own palette, so there is no theme grid.
  const { isReady, setThemeMode, themeIds, themeMode } = useAppearancePreferences();

  return (
    <View className="gap-6">
      <View className="gap-2">
        <SectionLabel>Esquema de cores</SectionLabel>
        <View accessibilityRole="radiogroup" className="flex-row gap-2">
          {APPEARANCE_MODES.map((mode) => (
            <ModeCard
              disabled={!isReady}
              key={mode.id}
              label={mode.label}
              mode={mode.id}
              onPress={() => setThemeMode(mode.id)}
              selected={mode.id === themeMode}
              themeIds={themeIds}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
