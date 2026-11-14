import { cn } from '@/lib/utils';

/** A unified diff with added and removed lines tinted; read-only. */
export function DiffView({ text, truncated }: { text: string; truncated: boolean }) {
  if (!text.trim()) return <p className="text-muted-foreground">Sem diferenças em relação ao último commit.</p>;
  return (
    <div>
      <pre aria-label="Diferenças" className="max-h-96 overflow-auto rounded-md border bg-background py-2 font-mono text-[12.5px] leading-relaxed">
        {text.split('\n').map((line, i) => (
          <div
            key={i}
            className={cn(
              'px-3 whitespace-pre',
              line.startsWith('+') && !line.startsWith('+++') && 'bg-primary/10 text-foreground',
              line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-foreground',
              line.startsWith('@@') && 'text-muted-foreground',
            )}
          >
            {line || ' '}
          </div>
        ))}
      </pre>
      {truncated && <p className="mt-1 text-xs text-muted-foreground">Diferença muito longa: mostrando o início.</p>}
    </div>
  );
}
