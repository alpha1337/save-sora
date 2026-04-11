import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as Label from "@radix-ui/react-label";
import { Check } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Small labeled checkbox wrapper used across source and result selection.
 */
export function Checkbox({ checked, disabled = false, id, label, onCheckedChange }: CheckboxProps) {
  return (
    <Label.Root className="ss-checkbox-row" htmlFor={id}>
      <CheckboxPrimitive.Root
        checked={checked}
        className="ss-checkbox"
        disabled={disabled}
        id={id}
        onCheckedChange={(nextValue) => onCheckedChange(Boolean(nextValue))}
      >
        <CheckboxPrimitive.Indicator>
          <Check size={14} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </Label.Root>
  );
}
