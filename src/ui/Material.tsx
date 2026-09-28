import type { Material } from '../domain/model';

export function Examples({ material }: { material: Material }) {
  return (
    <div class="examples">
      {material.examples.map((e) => {
        const i = e.text.indexOf(e.target);
        return (
          <p class="example" key={e.text}>
            {e.text.slice(0, i)}
            <mark>{e.target}</mark>
            {e.text.slice(i + e.target.length)}
          </p>
        );
      })}
    </div>
  );
}
