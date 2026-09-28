import { useI18n } from './i18n';
import { useId, useRef, useState } from 'preact/hooks';

export function Select({
  value,
  options,
  label,
  editable = false,
  change,
}: {
  value: string;
  options: { value: string; label: string }[];
  label: string;
  editable?: boolean;
  change: (value: string) => void;
}) {
  const t = useI18n();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const select = (value: string) => {
    change(value);
    setOpen(false);
    input.current?.focus();
  };
  return (
    <div
      class="select-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <label htmlFor={`${id}-input`}>{label}</label>
      <div class="select-control">
        <input
          id={`${id}-input`}
          ref={input}
          required
          readOnly={!editable}
          onClick={() => {
            setOpen(!open);
            setActive(options.findIndex((o) => o.value === value));
          }}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="none"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          value={editable ? value : (options.find((o) => o.value === value)?.label ?? value)}
          onInput={(event) => {
            change(event.currentTarget.value);
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const next = options.length
                ? (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                : -1;
              setActive(next);
              requestAnimationFrame(() =>
                document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' }),
              );
            }
            if (!editable && event.key === ' ' && !open) {
              event.preventDefault();
              setOpen(true);
              setActive(options.findIndex((o) => o.value === value));
            }
            if ((event.key === 'Enter' || (!editable && event.key === ' ')) && open) {
              event.preventDefault();
              if (options[active]) select(options[active].value);
            }
          }}
        />
        <button
          type="button"
          class="select-toggle"
          aria-label={t('选择{0}', label)}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onClick={() => {
            setOpen(!open);
            setActive(options.findIndex((o) => o.value === value));
            input.current?.focus();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {open && (
        <div id={`${id}-list`} class="select-menu" role="listbox" aria-label={t('可用{0}', label)}>
          {options.length ? (
            options.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                key={option.value}
                aria-selected={option.value === value}
                class={index === active ? 'active' : ''}
                onClick={() => select(option.value)}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p class="muted">{t('暂无模型，可刷新或手动填写。')}</p>
          )}
        </div>
      )}
    </div>
  );
}
