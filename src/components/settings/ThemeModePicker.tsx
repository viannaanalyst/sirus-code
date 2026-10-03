import { useId } from "react";
import type { AppSettings } from "@/client/types";
import { useTranslation } from "@/i18n/use-translation";

function Mockup({ variant }: { variant: "light" | "dark" }) {
  return <div className="theme-mockup" data-variant={variant} aria-hidden="true"><div className="theme-mockup-panel"><div className="theme-mockup-heading"><i /><i /></div><div className="theme-mockup-card">{[0, 1, 2].map(row => <div key={row}><i /><hr /></div>)}</div></div></div>;
}

/** Native radios supply keyboard navigation and selection semantics. */
export function ThemeModePicker({ value, onChange }: { value: AppSettings["theme"]; onChange: (value: AppSettings["theme"]) => void }) {
  const t = useTranslation();
  const name = useId();
  return <fieldset className="appearance-theme-picker"><legend className="sr-only">{t("Theme")}</legend>
    {([{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }] as const).map(choice => <label key={choice.value} className="appearance-theme-option">
      <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
      <span className="appearance-theme-frame"><span className="appearance-theme-art"><Mockup variant={choice.value === "dark" ? "dark" : "light"} />{choice.value === "system" && <span className="theme-mockup-half"><Mockup variant="dark" /></span>}</span></span>
      <span className="ui-control appearance-theme-label">{t(choice.label)}</span>
    </label>)}
  </fieldset>;
}
