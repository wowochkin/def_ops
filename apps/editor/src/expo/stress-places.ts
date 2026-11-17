/** Названия, для которых можно переносить уже подтверждённое ударение на простые падежные формы. */
import PLACES_RU from '../../../../packages/sim/data/places-ru.json';
import ALIASES from '../voice/place-aliases.json';

const tokens = (s: string) => s.match(/[\p{Script=Cyrillic}]+/gu) ?? [];
export const STRESS_PLACE_WORDS = [...new Set([
  ...Object.values(PLACES_RU),
  ...Object.values(ALIASES).flatMap(x => Array.isArray(x) ? x : []),
  'Одер', 'Шпрее', 'Эльба', 'Нейсе', 'Люккау',
].flatMap(tokens).filter(w => /^[А-ЯЁ]/.test(w) && w.length > 1))];

/** Только имена на нешипящую твёрдую согласную. Род и окончания названий на ж/ш/ч/щ не угадываются. */
export function placeWordForms(word: string): string[] {
  if (!/[бвгдзклмнпрстфхц]$/i.test(word)) return [word];
  return [word, `${word}а`, `${word}у`, `${word}${/ц$/i.test(word) ? 'ем' : 'ом'}`, `${word}е`];
}

const families = STRESS_PLACE_WORDS.map(word => ({ word, forms: placeWordForms(word) }));

/**
 * Производные записи существуют только в памяти. Явные записи не меняются; при разных ударениях
 * в одной основе ничего не выводится. Обычные слова и похожие названия сюда не попадают.
 */
export function placeStressForms(words: Record<string, string>): Record<string, string> {
  const explicit = new Map(Object.entries(words).map(([w, say]) => [w.toLowerCase(), say]));
  const result: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const { word, forms } of families) {
    if (forms.length < 2) continue;
    const known = forms.flatMap(f => {
      const say = explicit.get(f.toLowerCase());
      return say ? [{ word: f, say }] : [];
    });
    if (!known.length) continue;
    const accents = known.map(({ word: form, say }) => {
      if (say.replace(/\+/g, '').toLowerCase() !== form.toLowerCase() || (say.match(/\+[аеёиоуыэюя]/gi)?.length ?? 0) !== 1) return -1;
      const at = say.indexOf('+');
      return at < word.length ? at : -1;
    });
    if (accents.some(x => x < 0 || x !== accents[0])) continue;
    for (const form of forms) {
      const key = form.toLowerCase();
      if (explicit.has(key) || ambiguous.has(key)) continue;
      const say = form.slice(0, accents[0]) + '+' + form.slice(accents[0]);
      if (result[key] && result[key].toLowerCase() !== say.toLowerCase()) {
        delete result[key]; ambiguous.add(key);
      } else result[key] = say;
    }
  }
  return result;
}
