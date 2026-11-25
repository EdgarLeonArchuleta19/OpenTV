import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface LiveSelectOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Full-width dark dropdown for the Live TV channel panel ("<Grupo> · <count>").
 * Same behaviour as the source picker's select: arrows move, Enter picks,
 * Esc closes and gives focus back to the button; keys never reach the player shortcuts.
 */
export const LiveSelect: React.FC<{
  ariaLabel: string;
  value: string;
  options: LiveSelectOption[];
  onChange: (value: string) => void;
}> = ({ ariaLabel, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    itemRefs.current[idx]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // Focus the current value only when the list opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(options.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      e.stopPropagation();
      close();
      return;
    } else if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
    if (next >= 0) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border px-3 text-left text-[14px] text-fg transition cursor-pointer ${
          open ? 'border-[var(--ot-accent)] bg-elev-hi' : 'border-transparent bg-elev hover:bg-elev-hi'
        }`}
      >
        <span className="min-w-0 truncate">
          {current?.label}
          {current?.count !== undefined && <span className="text-fg/55 light:text-muted"> · {current.count}</span>}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-fg/70 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onListKey}
          className="ot-scroll absolute top-full right-0 left-0 z-40 mt-1.5 max-h-[360px] overflow-y-auto rounded-xl border border-fg/10 bg-[#1b1b20] p-1 shadow-[0_18px_50px_rgba(0,0,0,0.7)] light:bg-surface light:shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] transition cursor-pointer hover:bg-fg/[0.08] focus:bg-fg/[0.1] focus:outline-none ${
                  selected ? 'font-bold text-fg' : 'text-fg/80'
                }`}
              >
                <Check className={`h-4 w-4 shrink-0 ${selected ? 'text-[var(--ot-accent)]' : 'opacity-0'}`} />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="pl-3 text-[12.5px] tabular-nums text-fg/40 light:text-muted">{o.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
