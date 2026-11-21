export function ForcesStep() {
  return <section>
    <h2>Силы и состояние</h2>
    <div role="tablist" aria-label="Состояние силы">
      {['Оснащённость', 'МПС', 'Готовность', 'Построение', 'МТО'].map(title => <button role="tab" key={title}>{title}</button>)}
    </div>
  </section>;
}
