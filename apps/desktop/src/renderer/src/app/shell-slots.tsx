import * as React from 'react';
import { createPortal } from 'react-dom';

/*
 * Optional shell regions (lote 50.03): a contextual right panel and a bottom timeline. A page fills them by rendering
 * <ShellAside> or <ShellTimeline> anywhere in its tree; the content is portalled into the shell. Pages that render
 * neither keep today's layout exactly.
 */

type SlotName = 'aside' | 'timeline';

interface SlotState {
  targets: Record<SlotName, HTMLElement | null>;
  counts: Record<SlotName, number>;
  titles: string[];
  register: (slot: SlotName, title?: string) => () => void;
  setTarget: (slot: SlotName, element: HTMLElement | null) => void;
}

const ShellSlotsContext = React.createContext<SlotState | null>(null);

export function ShellSlotsProvider({ children }: { children: React.ReactNode }) {
  const [targets, setTargets] = React.useState<Record<SlotName, HTMLElement | null>>({ aside: null, timeline: null });
  const [counts, setCounts] = React.useState<Record<SlotName, number>>({ aside: 0, timeline: 0 });
  const [titles, setTitles] = React.useState<string[]>([]);

  const register = React.useCallback((slot: SlotName, title?: string) => {
    setCounts((current) => ({ ...current, [slot]: current[slot] + 1 }));
    if (title) setTitles((current) => [...current, title]);
    return () => {
      setCounts((current) => ({ ...current, [slot]: Math.max(0, current[slot] - 1) }));
      if (title) setTitles((current) => {
        const index = current.lastIndexOf(title);
        return index === -1 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
      });
    };
  }, []);

  const setTarget = React.useCallback((slot: SlotName, element: HTMLElement | null) => {
    setTargets((current) => (current[slot] === element ? current : { ...current, [slot]: element }));
  }, []);

  const value = React.useMemo(() => ({ targets, counts, titles, register, setTarget }), [targets, counts, titles, register, setTarget]);
  return <ShellSlotsContext.Provider value={value}>{children}</ShellSlotsContext.Provider>;
}

function useSlots(): SlotState {
  const context = React.useContext(ShellSlotsContext);
  if (!context) throw new Error('Shell slots are only available inside AppShell.');
  return context;
}

/** For the shell itself: whether a slot has content (and the aside's title). */
export function useShellSlotState(slot: SlotName): { active: boolean; title: string | undefined } {
  const { counts, titles } = useSlots();
  return { active: counts[slot] > 0, title: slot === 'aside' ? titles.at(-1) : undefined };
}

/** For the shell itself: the callback ref that marks where a slot renders. */
export function useShellSlotTarget(slot: SlotName): (element: HTMLElement | null) => void {
  const { setTarget } = useSlots();
  return React.useCallback((element: HTMLElement | null) => setTarget(slot, element), [setTarget, slot]);
}

function SlotPortal({ slot, title, children }: { slot: SlotName; title?: string; children: React.ReactNode }) {
  const { targets, register } = useSlots();
  React.useEffect(() => register(slot, title), [register, slot, title]);
  const target = targets[slot];
  return target ? createPortal(children, target) : null;
}

/** Right contextual panel for the current page. `title` names the panel for assistive tech and the narrow-window toggle. */
export function ShellAside({ title, children }: { title: string; children: React.ReactNode }) {
  return <SlotPortal slot="aside" title={title}>{children}</SlotPortal>;
}

/** Optional bottom timeline for the current page. */
export function ShellTimeline({ children }: { children: React.ReactNode }) {
  return <SlotPortal slot="timeline">{children}</SlotPortal>;
}
