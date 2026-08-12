import type { CSSProperties, ReactNode } from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

/** Neumorphic switch — matches Settings appearance. */
export function NeoToggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={`neo-toggle ${disabled ? "neo-toggle-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="neo-toggle-track">
        <span className="neo-toggle-thumb" />
      </span>
      {label != null && <span className="neo-toggle-label">{label}</span>}
    </label>
  );
}

interface CheckProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

/** Compact neumorphic checkbox for lists. */
export function NeoCheck({ checked, onChange, label, disabled }: CheckProps) {
  return (
    <label className={`neo-check ${disabled ? "neo-check-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="neo-check-box" aria-hidden>
        <span className="neo-check-mark" />
      </span>
      {label != null && <span className="neo-check-label">{label}</span>}
    </label>
  );
}

interface RangeProps {
  id?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  "aria-label"?: string;
  disabled?: boolean;
}

/** Neumorphic range slider with accent fill. */
export function NeoRange({
  id,
  min,
  max,
  step = 1,
  value,
  onChange,
  "aria-label": ariaLabel,
  disabled,
}: RangeProps) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className={`neo-range ${disabled ? "neo-range-disabled" : ""}`}>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ "--neo-range-pct": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
