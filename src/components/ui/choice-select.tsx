import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

export function ChoiceSelect({ label, value, options, onChange, disabled, className = "" }: {
  label: string; value: string; options: { value: string; label: string; separator?: boolean }[];
  onChange: (value: string) => void; disabled?: boolean; className?: string;
}) {
  return <Select.Root value={value} disabled={disabled} onValueChange={next => { if (next !== null) onChange(next); }}>
    <Select.Trigger aria-label={label} className={`flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border bg-background px-2.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${className}`}>
      <span className="truncate">{options.find(option => option.value === value)?.label}</span><Select.Icon><ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal><Select.Positioner sideOffset={5} align="start" alignItemWithTrigger={false} className="z-[70] outline-none">
      <Select.Popup className="max-h-[min(320px,var(--available-height))] w-[var(--anchor-width)] min-w-36 overflow-y-auto overscroll-contain rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
        <Select.List>{options.map(option => <Select.Item key={option.value} value={option.value} className={`relative flex min-h-8 cursor-default items-center rounded-md py-1.5 pr-7 pl-2.5 text-xs outline-none data-highlighted:bg-accent data-selected:font-medium ${option.separator ? "mt-1 border-t pt-2.5" : ""}`}>
          <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator className="absolute right-2"><Check aria-hidden="true" className="size-3.5" /></Select.ItemIndicator>
        </Select.Item>)}</Select.List>
      </Select.Popup>
    </Select.Positioner></Select.Portal>
  </Select.Root>;
}
