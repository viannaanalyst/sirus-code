import { Host, Slider } from "@expo/ui/swift-ui";
import { accessibilityLabel, accessibilityValue, disabled, tint } from "@expo/ui/swift-ui/modifiers";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, type ComponentProps } from "react";
import { View } from "react-native";

import { SymbolView } from "../../../../components/AppSymbol";
import { AppText as Text } from "../../../../components/AppText";
import { useUniwindTheme } from "../../../../lib/useUniwindTheme";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

type SymbolName = ComponentProps<typeof SymbolView>["name"];

/**
 * A font size row with iOS's own slider (SwiftUI, through `@expo/ui`)
 * `SliderRow`: the value snaps to its step and commits when the finger lifts, with a tick.
 */
export function FontSizeSliderRow(props: {
  readonly disabled?: boolean;
  readonly icon: SymbolName;
  readonly label: string;
  readonly valueLabel: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const theme = useUniwindTheme();
  const { themeAppearance } = useAppearancePreferences();
  const draft = useRef(props.value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) draft.current = props.value;
  }, [props.value]);
  const commit = (value: number) => {
    if (props.disabled) return;
    const next = Math.min(props.max, Math.max(props.min, props.min + Math.round((value - props.min) / props.step) * props.step));
    if (next === props.value) return;
    void Haptics.selectionAsync().catch(() => undefined);
    props.onChange(next);
  };
  return <View className={props.disabled ? "gap-1 p-4 opacity-[0.45]" : "gap-1 p-4"}>
    <View className="flex-row items-center gap-4">
      <SymbolView name={props.icon} size={22} tintColorClassName="accent-icon" type="monochrome" weight="regular" />
      <Text className="flex-1 text-lg text-foreground">{props.label}</Text>
      <Text className="text-base font-app-medium text-foreground-muted">{props.valueLabel}</Text>
    </View>
    <View className="flex-row items-center gap-3">
      <SymbolView name="textformat.size.smaller" size={15} tintColorClassName="accent-icon-muted" type="monochrome" weight="regular" />
      <Host style={{ flex: 1, height: 44 }} colorScheme={themeAppearance} seedColor={theme["--color-foreground"]}>
        <Slider
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          modifiers={[tint(theme["--color-foreground"]), disabled(Boolean(props.disabled)), accessibilityLabel(props.label), accessibilityValue(props.valueLabel)]}
          onValueChange={(value) => {
            draft.current = value;
            // VoiceOver adjustments do not begin a touch, so they commit at once.
            if (!editing.current) commit(value);
          }}
          onEditingChanged={(isEditing) => {
            editing.current = isEditing;
            if (!isEditing) commit(draft.current);
          }}
        />
      </Host>
      <SymbolView name="textformat.size.larger" size={22} tintColorClassName="accent-icon-muted" type="monochrome" weight="regular" />
    </View>
  </View>;
}
