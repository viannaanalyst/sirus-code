"use client";

import { forwardRef, useId, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { AnimatePresence, motion } from "motion/react";
import { useArcReducedMotion as useReducedMotion } from "../lib/use-arc-motion";
import type { Variants } from "motion/react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./select.module.css";

export interface SelectProps extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children"> {
  label: string;
  /** Host rows already show the label; keep its native association visually hidden. */
  hideLabel?: boolean;
  description?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  options: { value: string; label: string; disabled?: boolean; icon?: ReactNode; description?: string }[];
  /** Edge the menu shares with the trigger when its content is wider. */
  align?: "start" | "end";
}

/** The shown value rolls in the direction of the list: a later option rises from below, an earlier one drops from above. */
const valueRoll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 0.35}em`, filter: `blur(${motionTokens.blur.soft}px)` }),
  center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } },
  exit: (direction: number) => ({ opacity: 0, y: `${direction * -0.3}em`, filter: `blur(${motionTokens.blur.subtle}px)`, transition: { duration: motionTokens.duration.fast, ease: [...motionTokens.ease.standard] } }),
};
/** Reduced motion keeps a short crossfade; the resting state matches valueRoll so server and client markup agree. */
const valueFade: Variants = { enter: { opacity: 0 }, center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, exit: { opacity: 0, transition: { duration: motionTokens.duration.instant } } };

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { label, hideLabel = false, description, placeholder = "Select an option", options, id, className, disabled, onValueChange, align = "start", ...rootProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = description ? `${controlId}-description` : undefined;
  const reduceMotion = useReducedMotion();
  const [uncontrolledValue, setUncontrolledValue] = useState(rootProps.defaultValue ?? "");
  const currentValue = rootProps.value ?? uncontrolledValue;
  const index = options.findIndex((option) => option.value === currentValue);
  const selectedOption = options[index];
  const shown = currentValue ? selectedOption?.label ?? "" : placeholder;
  const [previousIndex, setPreviousIndex] = useState(index);
  const [direction, setDirection] = useState(1);
  if (previousIndex !== index) { setPreviousIndex(index); setDirection(index > previousIndex ? 1 : -1); }

  return (
    <div className={styles.field}>
      <label htmlFor={controlId} className={hideLabel ? styles.srOnly : undefined}>{label}</label>
      <SelectPrimitive.Root {...rootProps} disabled={disabled} onValueChange={(next) => { setUncontrolledValue(next); onValueChange?.(next); }}>
        <SelectPrimitive.Trigger
          ref={ref}
          id={controlId}
          aria-describedby={hintId}
          className={[styles.trigger, className].filter(Boolean).join(" ")}
        >
          {/* Radix keeps the real value for assistive tech; the visible copy below animates between values. */}
          <span className={styles.srOnly}><SelectPrimitive.Value placeholder={placeholder} /></span>
          <span className={styles.valueText} aria-hidden="true">
            <AnimatePresence initial={false} custom={direction}>
              <motion.span key={currentValue ? `value-${currentValue}` : "placeholder"} data-placeholder={currentValue ? undefined : ""} custom={direction} variants={reduceMotion ? valueFade : valueRoll} initial="enter" animate="center" exit="exit">
                {selectedOption?.icon ? <span className={styles.optionIcon}>{selectedOption.icon}</span> : null}
                <span className={styles.optionLabel}>{shown}</span>
              </motion.span>
            </AnimatePresence>
          </span>
          <SelectPrimitive.Icon className={styles.chevron}>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content data-appearance-floating="true" className={styles.content} position="popper" align={align} sideOffset={4} collisionPadding={12}>
            <div className={styles.scrollButtonSlot}>
              <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
                <ChevronUp size={15} strokeWidth={1.8} aria-hidden="true" />
              </SelectPrimitive.ScrollUpButton>
            </div>
            <SelectPrimitive.Viewport className={styles.viewport}>
              {options.map((option) => (
                <SelectPrimitive.Item key={option.value} value={option.value} textValue={option.label} disabled={option.disabled} className={styles.item}>
                  {option.icon ? <span className={styles.optionIcon} aria-hidden="true">{option.icon}</span> : null}
                  <span className={styles.optionCopy}>
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    {option.description ? <span className={styles.optionDescription}>{option.description}</span> : null}
                  </span>
                  <SelectPrimitive.ItemIndicator className={styles.indicator}>
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <div className={styles.scrollButtonSlot}>
              <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
                <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
              </SelectPrimitive.ScrollDownButton>
            </div>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {description && <span id={hintId} className={styles.hint}>{description}</span>}
    </div>
  );
});
