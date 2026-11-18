import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Native form controls styled with the app tokens: full keyboard and screen-reader support for free.
// No field in the app is a login field, so browser autocomplete is off by default.

const control =
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-ring/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input autoComplete="off" className={cn(control, 'h-9', className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative w-full">
      <select className={cn(control, 'h-9 appearance-none pr-9', className)} {...props} />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--chip-violet-fg,#8b6cf0)]"
      />
    </div>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea autoComplete="off" className={cn(control, 'py-2 leading-relaxed', className)} {...props} />;
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
