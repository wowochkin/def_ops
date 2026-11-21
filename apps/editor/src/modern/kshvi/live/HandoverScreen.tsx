export function HandoverScreen({ onHandover }: { onHandover: () => void }) {
  return <main>
    <h1>Рабочее место передано</h1>
    <p>Привилегированная проекция закрыта. Новый участник должен войти со своей ролью.</p>
    <button onClick={onHandover}>Подтвердить передачу</button>
  </main>;
}
