import type { ReactElement, ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

/** Label shown on hover and keyboard focus, for controls that show only an icon. */
export function Tooltip({ label, side = 'right', disabled = false, children }: { label: ReactNode; side?: 'right' | 'bottom' | 'top' | 'left'; disabled?: boolean; children: ReactElement }) {
  if (disabled) return children;
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 motion-reduce:animate-none"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
