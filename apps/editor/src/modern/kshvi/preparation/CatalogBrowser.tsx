export function CatalogBrowser({ total, categories, operations }: { total: number; categories: number; operations: number }) {
  return <section><h2>Библиотека событий</h2><p>{total} событий · {categories} категорий · {operations} операций</p></section>;
}
