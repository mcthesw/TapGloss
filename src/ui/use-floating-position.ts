import type { RefObject, JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

type Position = { left: number; top: number };
export function useFloatingPosition(root: RefObject<HTMLElement>, x: number, y: number) {
  const [position, setPosition] = useState<Position>({ left: 12, top: 12 });
  const moved = useRef<Position>();
  const drag = useRef<{ id: number; x: number; y: number; origin: Position }>();
  const constrain = (next: Position) => {
    const rect = root.current!.getBoundingClientRect();
    return {
      left: Math.max(12, Math.min(next.left, window.innerWidth - rect.width - 12)),
      top: Math.max(12, Math.min(next.top, window.innerHeight - rect.height - 12)),
    };
  };
  const move = (next: Position) => {
    moved.current = constrain(next);
    setPosition(moved.current);
  };
  useLayoutEffect(() => {
    moved.current = undefined;
    const place = () => {
      const rect = root.current!.getBoundingClientRect();
      const top = y + 12 + rect.height <= window.innerHeight - 12 ? y + 12 : y - rect.height - 12;
      const next = constrain(moved.current ?? { left: x, top });
      if (moved.current) moved.current = next;
      setPosition((old) => (old.left === next.left && old.top === next.top ? old : next));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(root.current!);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [x, y]);
  const handle: JSX.HTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
    },
    onPointerMove: (event) => {
      const active = drag.current;
      if (!active || active.id !== event.pointerId) return;
      move({
        left: active.origin.left + event.clientX - active.x,
        top: active.origin.top + event.clientY - active.y,
      });
    },
    onPointerUp: (event) => {
      if (drag.current?.id !== event.pointerId) return;
      drag.current = undefined;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onLostPointerCapture: () => {
      drag.current = undefined;
    },
    onPointerCancel: () => {
      drag.current = undefined;
    },
    onKeyDown: (event) => {
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      move({ left: position.left + direction[0] * 16, top: position.top + direction[1] * 16 });
    },
  };
  return { position, handle };
}
