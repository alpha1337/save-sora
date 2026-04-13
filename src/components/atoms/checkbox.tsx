import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as Label from "@radix-ui/react-label";
import { Circle, CircleCheckBig } from "lucide-react";
import type { CheckedState } from "@radix-ui/react-checkbox";

interface CheckboxProps {
  ariaLabel?: string;
  checked: CheckedState;
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Small labeled checkbox wrapper used across source and result selection.
 */
export function Checkbox({ ariaLabel, checked, disabled = false, id, label, onCheckedChange }: CheckboxProps) {
  const isChecked = checked === true;

  return (
    <Label.Root className="ss-checkbox-row" htmlFor={id}>
      <CheckboxPrimitive.Root
        aria-label={ariaLabel}
        checked={checked}
        className="ss-checkbox"
        disabled={disabled}
        id={id}
        onCheckedChange={(nextValue) => onCheckedChange(Boolean(nextValue))}
      >
        <span className={`ss-checkbox-icon${isChecked ? " is-checked" : ""}`} aria-hidden="true">
          {isChecked ? <CircleCheckBig size={16} /> : <Circle size={16} />}
        </span>
        <CheckboxPrimitive.Indicator />
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </Label.Root>
  );
}
