import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  "aria-label"?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Shared select primitive backed by Radix.
 */
export function Select({ "aria-label": ariaLabel, onValueChange, options, value }: SelectProps) {
  return (
    <SelectPrimitive.Root onValueChange={onValueChange} value={value}>
      <SelectPrimitive.Trigger aria-label={ariaLabel} className="ss-select-trigger">
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden="true" size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ss-select-content" position="popper">
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item className="ss-select-item" key={option.value} value={option.value}>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check aria-hidden="true" size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
