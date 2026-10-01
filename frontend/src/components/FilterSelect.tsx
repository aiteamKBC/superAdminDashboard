import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface FilterSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  minWidth?: number;
}

export default function FilterSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
  minWidth = 160,
}: FilterSelectProps) {
  const selected = options.find((o) => o.value === value);
  const EMPTY_VALUE = "__filter_select_empty__";
  const toSelectValue = (optionValue: string) => optionValue === "" ? EMPTY_VALUE : optionValue;
  const fromSelectValue = (optionValue: string) => optionValue === EMPTY_VALUE ? "" : optionValue;

  return (
    <RadixSelect.Root value={toSelectValue(value)} onValueChange={(next) => onChange(fromSelectValue(next))}>
      <RadixSelect.Trigger
        className={cn(
          "flex h-10 items-center justify-between gap-2 rounded-lg border border-[#E2DCF8] bg-white px-3 text-sm font-medium text-[#1D1050] shadow-sm outline-none transition-colors hover:border-[#5B47D5] hover:bg-[#F8FBFE] focus:border-[#5B47D5] focus:ring-2 focus:ring-[#5B47D5]/20 data-[state=open]:border-[#5B47D5] data-[state=open]:ring-2 data-[state=open]:ring-[#5B47D5]/20",
          className
        )}
        style={{ minWidth }}
      >
        <RadixSelect.Value placeholder={placeholder}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </RadixSelect.Value>
        <RadixSelect.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#9B94C8] transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          align="start"
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[#E2DCF8] bg-white shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <RadixSelect.ScrollUpButton className="flex h-7 cursor-default items-center justify-center border-b border-[#E8EFF7] bg-[#F8FBFE] text-[#6E6D8A]">
            <ChevronUp className="h-4 w-4" />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="filter-select-viewport max-h-72 overflow-y-scroll p-1 pr-2">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={toSelectValue(opt.value)}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#1D1050] outline-none transition-colors hover:bg-[#EEF3FB] focus:bg-[#EEF3FB] data-[state=checked]:bg-[#EEF3FB] data-[state=checked]:font-semibold data-[state=checked]:text-[#5B47D5]"
              >
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto">
                  <Check className="h-3.5 w-3.5 text-[#5B47D5]" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-7 cursor-default items-center justify-center border-t border-[#E8EFF7] bg-[#F8FBFE] text-[#6E6D8A]">
            <ChevronDown className="h-4 w-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
