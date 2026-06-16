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

  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        className={cn(
          "flex h-10 items-center justify-between gap-2 rounded-lg border border-[#D7E5F3] bg-white px-3 text-sm font-medium text-[#14264A] shadow-sm outline-none transition-colors hover:border-[#1E6ACB] hover:bg-[#F8FBFE] focus:border-[#1E6ACB] focus:ring-2 focus:ring-[#1E6ACB]/20 data-[state=open]:border-[#1E6ACB] data-[state=open]:ring-2 data-[state=open]:ring-[#1E6ACB]/20",
          className
        )}
        style={{ minWidth }}
      >
        <RadixSelect.Value placeholder={placeholder}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </RadixSelect.Value>
        <RadixSelect.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#8AA0B6] transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          align="start"
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[#DDE7F0] bg-white shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <RadixSelect.ScrollUpButton className="flex h-7 cursor-default items-center justify-center border-b border-[#E8EFF7] bg-[#F8FBFE] text-[#5F7288]">
            <ChevronUp className="h-4 w-4" />
          </RadixSelect.ScrollUpButton>

          <RadixSelect.Viewport className="filter-select-viewport max-h-72 overflow-y-scroll p-1 pr-2">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm text-[#14264A] outline-none transition-colors hover:bg-[#EEF3FB] focus:bg-[#EEF3FB] data-[state=checked]:bg-[#EEF3FB] data-[state=checked]:font-semibold data-[state=checked]:text-[#1E6ACB]"
              >
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto">
                  <Check className="h-3.5 w-3.5 text-[#1E6ACB]" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>

          <RadixSelect.ScrollDownButton className="flex h-7 cursor-default items-center justify-center border-t border-[#E8EFF7] bg-[#F8FBFE] text-[#5F7288]">
            <ChevronDown className="h-4 w-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
