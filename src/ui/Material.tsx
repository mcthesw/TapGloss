import { useI18n } from './i18n';
import type { Material } from '../domain/model';

export function Examples({ material, numbered = false }: { material: Material; numbered?: boolean }) {
  const t = useI18n();
  const items = material.examples.map((e) => {
    const i = e.text.indexOf(e.target);
    const text = (
      <>
        {e.text.slice(0, i)}
        <mark>{e.target}</mark>
        {e.text.slice(i + e.target.length)}
      </>
    );
    return numbered ? (
      <li class="example" key={e.text}>
        {text}
      </li>
    ) : (
      <p class="example" key={e.text}>
        {text}
      </p>
    );
  });
  return numbered ? (
    <ol class="examples lookup-examples" aria-label={t('例句')}>
      {items}
    </ol>
  ) : (
    <div class="examples">{items}</div>
  );
}
