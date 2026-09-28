import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';

export function Help({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false),
    [pinned, setPinned] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelLeave = () => clearTimeout(leaveTimer.current);
  const id = useId();
  useEffect(() => () => cancelLeave(), []);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      class="help"
      onPointerEnter={() => {
        cancelLeave();
        setOpen(true);
      }}
      onPointerLeave={() => {
        if (!pinned && !root.current?.contains(document.activeElement))
          leaveTimer.current = setTimeout(() => setOpen(false), 180);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!pinned && !root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        class="help-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          cancelLeave();
          setPinned(!pinned);
          setOpen(!pinned);
        }}
      >
        ?
      </button>
      {open && (
        <div class="help-popover" id={id} role="region" aria-label={label}>
          <div class="help-content">{children}</div>
        </div>
      )}
    </div>
  );
}
