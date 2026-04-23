import * as SwitchPrimitive from "@radix-ui/react-switch";

interface SwitchProps {
  ariaLabel?: string;
  checked: boolean;
  disabled?: boolean;
  id: string;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Simple reusable switch primitive with app-level styling hooks.
 */
export function Switch({ ariaLabel, checked, disabled = false, id, onCheckedChange }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      aria-label={ariaLabel}
      checked={checked}
      className="ss-switch"
      disabled={disabled}
      id={id}
      onCheckedChange={onCheckedChange}
      type="button"
    >
      <SwitchPrimitive.Thumb className="ss-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

