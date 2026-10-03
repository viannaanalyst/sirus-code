import ArcSegmentedControl from "@/components/arc/segmented-control/segmented-control";
import type { ReactNode } from "react";
interface Option<T extends string> { value: T; label: string; content?: ReactNode; }
interface Props<T extends string> { value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean; label?: string; }
export function SegmentedControl<T extends string>({ value, options, onChange, disabled, label }: Props<T>) {
  return <ArcSegmentedControl value={value} options={options} disabled={disabled} label={label} onValueChange={(next) => {
    const option = options.find((item) => item.value === next);
    if (option) onChange(option.value);
  }} />;
}
