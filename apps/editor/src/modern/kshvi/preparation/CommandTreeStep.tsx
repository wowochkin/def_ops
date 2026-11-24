import { requiredIntermediaries, type CommandTree } from '@def-ops/kshvi/browser';

export function CommandTreeStep(tree: CommandTree) {
  const missing = requiredIntermediaries(tree);
  return <section>
    <h2>Дерево инстанций</h2>
    {missing.map(edge => <p role="alert" key={`${edge.from}-${edge.to}`}>На активном стыке {edge.from} → {edge.to} нужна роль розыгрыша</p>)}
  </section>;
}
