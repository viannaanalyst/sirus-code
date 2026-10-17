import ExpoSegmentedControl from "@expo/ui/community/segmented-control";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import { View, type NativeSyntheticEvent, type ViewProps } from "react-native";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { flattenThemeColor, themeColorWithAlpha, themeColorWithContrast } from "../lib/mobileTheme";

interface NativeSegmentedControlProps extends ViewProps {
  readonly labels: string[];
  readonly selectedIndex: number;
  readonly trackColor: string;
  readonly selectedColor: string;
  readonly textColor: string;
  readonly mutedColor: string;
  readonly appearance: string;
  readonly onSelectionChange: (event: NativeSyntheticEvent<{ index: number }>) => void;
}

// A build from before runtime 4 has no `SirusNativeControls` view; it keeps the untinted
// SwiftUI picker from `@expo/ui`.
function resolveNativeSegmentedControl() {
  try {
    const module = requireOptionalNativeModule<{
      readonly ViewPrototypes?: { readonly SirusNativeControls_SegmentedControl?: unknown };
    }>("SirusNativeControls");
    if (!module?.ViewPrototypes?.SirusNativeControls_SegmentedControl) return null;
    return requireNativeView<NativeSegmentedControlProps>("SirusNativeControls", "SegmentedControl");
  } catch {
    return null;
  }
}
const NativeSegmentedControl = resolveNativeSegmentedControl();

export interface SegmentedControlProps<Value extends string | number> {
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
  /** Compact is a 32-point capsule; the default is 36 points. */
  readonly size?: "default" | "compact";
  readonly className?: string;
}

/**
 * A native iOS segmented control in the theme's colours: the track is the prominent action
 * colour washed over the screen, the selected segment is the prominent action in dark and the
 * secondary fill in light, and the idle labels keep a readable contrast against the track.
 */
export function SegmentedControl<Value extends string | number>(props: SegmentedControlProps<Value>) {
  const { themeVariables: colors, themeAppearance: colorScheme } = useAppearancePreferences();
  const selectedIndex = props.options.findIndex((option) => option.value === props.selected);
  const select = (index: number) => {
    const option = props.options[index];
    if (option) props.onSelect(option.value);
  };
  if (!NativeSegmentedControl) {
    return <View className={props.className}>
      <ExpoSegmentedControl
        values={props.options.map((option) => option.label)}
        selectedIndex={selectedIndex}
        onChange={({ nativeEvent }) => select(nativeEvent.selectedSegmentIndex)}
      />
    </View>;
  }
  const dark = colorScheme === "dark";
  const trackColor = flattenThemeColor(
    themeColorWithAlpha(colors["--color-prominent-action"], dark ? 0.18 : 0.07),
    colors["--color-screen"],
  );
  return <View className={props.className}>
    <NativeSegmentedControl
      labels={props.options.map((option) => option.label)}
      selectedIndex={selectedIndex}
      trackColor={trackColor}
      selectedColor={dark ? colors["--color-prominent-action"] : colors["--color-secondary"]}
      textColor={dark ? colors["--color-prominent-action-foreground"] : colors["--color-secondary-foreground"]}
      mutedColor={themeColorWithContrast(colors["--color-foreground-muted"], trackColor, dark ? 7 : 4.5)}
      appearance={colorScheme}
      onSelectionChange={({ nativeEvent }) => select(nativeEvent.index)}
      style={{ height: props.size === "compact" ? 32 : 36 }}
    />
  </View>;
}
