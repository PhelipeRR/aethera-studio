import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

// shadcn/ui Badge (new-york, radix). `success`, `warning` and `muted` are local variants on the theme's semantic
// tokens, so status pills never need raw palette colors.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default:
          'border-[#b8dc35] bg-[var(--brand-lime,#d8fb4f)] text-[var(--chip-violet-fg,#6a46d8)] font-semibold [a&]:hover:brightness-95',
        secondary:
          'border-[#b8dc35] bg-[var(--brand-lime,#d8fb4f)] text-[var(--chip-violet-fg,#6a46d8)] font-semibold [a&]:hover:brightness-95',
        destructive: 'bg-destructive/15 text-destructive focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/25',
        outline:
          'border-[#b8dc35] bg-[var(--brand-lime,#d8fb4f)] text-[var(--chip-violet-fg,#6a46d8)] font-medium [a&]:hover:brightness-95',
        ghost: '[a&]:hover:bg-[var(--brand-lime,#d8fb4f)] [a&]:hover:text-[var(--chip-violet-fg,#6a46d8)]',
        link: 'text-[var(--chip-violet-fg,#6a46d8)] underline-offset-4 [a&]:hover:underline',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        muted: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
