import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} class="paper modal" aria-labelledby={title} onCancel={close}>
      {children}
    </dialog>
  );
}
