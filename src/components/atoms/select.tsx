import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Circle, CircleCheckBig } from "lucide-react";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  "aria-label"?: string;
  disabled?: boolean;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Shared select primitive backed by Radix.
 */
export function Select({ "aria-label": ariaLabel, disabled = false, onValueChange, options, value }: SelectProps) {
  return (
    <SelectPrimitive.Root disabled={disabled} onValueChange={onValueChange} value={value}>
      <SelectPrimitive.Trigger aria-label={ariaLabel} className="ss-select-trigger" disabled={disabled}>
        <SelectPrimitive.Value className="ss-select-value" />
        <SelectPrimitive.Icon className="ss-select-chevron">
          <ChevronDown aria-hidden="true" size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          align="start"
          className="ss-select-content"
          collisionPadding={10}
          position="popper"
          side="bottom"
          sideOffset={6}
          sticky="always"
        >
          <SelectPrimitive.Viewport className="ss-select-viewport">
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <SelectPrimitive.Item className="ss-select-item" key={option.value} value={option.value}>
                  <span className="ss-select-item-marker" aria-hidden="true">
                    {isSelected ? <CircleCheckBig size={15} /> : <Circle size={15} />}
                  </span>
                  <SelectPrimitive.ItemText className="ss-select-item-text">{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
