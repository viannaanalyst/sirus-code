import { useEffect, useRef, useState } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useArcReducedMotion } from "@/components/arc/lib/use-arc-motion";
import "@/styles/orbit-switch.css";

interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onChange, disabled, label }: Props) {
  const reduced = useArcReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const [labelledBy, setLabelledBy] = useState<string>();
  const [change, setChange] = useState(0);
  useEffect(() => { setLabelledBy(ref.current?.closest<HTMLElement>("[data-setting-label]")?.dataset.settingLabel); }, []);
  return <SwitchPrimitive.Root ref={ref} className="orbit-switch" checked={checked} onCheckedChange={value => { setChange(count => count + 1); onChange(value); }} disabled={disabled}
    data-reduced={reduced || undefined} aria-label={label} aria-labelledby={label ? undefined : labelledBy}>
    <span className="orbit-switch-track" aria-hidden="true">
      <span className="orbit-switch-fill" />
      <span className="orbit-switch-signal" />
      <SwitchPrimitive.Thumb className="orbit-switch-position">
        <span className="orbit-switch-pearl" />
        <span key={change} className={`orbit-switch-ring${change ? " orbit-switch-ring-changing" : ""}`}><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="12" ry="4.5" /><circle cx="22.8" cy="10.1" r="1.7" /></svg></span>
      </SwitchPrimitive.Thumb>
    </span>
  </SwitchPrimitive.Root>;
}
