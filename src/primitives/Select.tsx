import { Select as ArcSelect } from "@/components/arc/select/select";
import type { ReactNode } from "react";

interface Option<T extends string> { value: T; label: string; disabled?: boolean; icon?: ReactNode; description?: string; }
interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}

/** Compact row control; the Arc/Radix select retains labels, focus and keyboard handling. */
export function Select<T extends string>({ value, options, onChange, label, className, disabled }: Props<T>) {
  return <ArcSelect align="end" disabled={disabled} hideLabel label={label} value={value} options={options} className={className} onValueChange={next => {
    const option = options.find(item => item.value === next && !item.disabled);
    if (option) onChange(option.value);
  }} />;
}
