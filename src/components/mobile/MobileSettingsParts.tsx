import type { ReactNode } from "react";
import { Check, ChevronRight } from "@/components/icons/phosphor";
import { Switch } from "@/primitives/Switch";

/** One settings row: icon, name, an optional value, and a chevron when it opens something. */
export function Row({ icon, label, value, onClick }: { icon: ReactNode; label: string; value?: ReactNode; onClick?: () => void }) {
  const body = <>
    <span className="mobile-settings-icon" aria-hidden="true">{icon}</span>
    <span className="mobile-settings-label">{label}</span>
    {value !== undefined ? <span className="mobile-settings-value">{value}</span> : null}
    {onClick ? <ChevronRight size={15} className="mobile-settings-chevron" aria-hidden="true" /> : null}
  </>;
  return onClick
    ? <button type="button" className="mobile-settings-row" onClick={onClick}>{body}</button>
    : <div className="mobile-settings-row">{body}</div>;
}

/** Options that exclude each other, each with a line of help and a check on the chosen one. */
export function Choices<T extends string>({ label, value, options, onChange, disabled = false }: { label: string; value: T; options: { id: T; title: string; help?: string }[]; onChange: (value: T) => void; disabled?: boolean }) {
  return <div className="mobile-card" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
    {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={value === option.id} disabled={disabled} className="mobile-choice" onClick={() => onChange(option.id)}>
      <span className="mobile-choice-text"><span className="mobile-option-title">{option.title}</span>{option.help ? <span className="mobile-choice-help">{option.help}</span> : null}</span>
      {value === option.id ? <Check size={17} className="mobile-choice-check" aria-hidden="true" /> : null}
    </button>)}
  </div>;
}

/** A switch with its icon, title and a line of help under the title. */
export function SwitchRow({ icon, label, help, checked, onChange, disabled = false }: { icon: ReactNode; label: string; help?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <div className="mobile-settings-row mobile-switch-row">
    <span className="mobile-settings-icon" aria-hidden="true">{icon}</span>
    <span className="mobile-switch-text"><span className="mobile-switch-label">{label}</span>{help ? <span className="mobile-choice-help">{help}</span> : null}</span>
    <Switch checked={checked} disabled={disabled} onChange={onChange} label={label} />
  </div>;
}
