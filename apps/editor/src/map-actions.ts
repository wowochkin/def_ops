/** Строка карты в «Карты → Подложки»: сводка и когда действие недоступно. */
import { countRu, type MapSource } from '@def-ops/core';

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');
export const fmtBytes = (b = 0) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : b > 1e6 ? `${(b / 1e6).toFixed(1)} МБ` : `${Math.round(b / 1e3)} КБ`);
/** «324 313 тайлов», «2 тайла». */
export const tilesText = (n: number) => countRu(n, 'тайл', 'тайла', 'тайлов');

/**
 * Сводка загруженной карты: векторная — «94 373 объекта · 137.2 МБ · данные на 15.10.2026»;
 * растровая — «1945 · z0–16 · 21 тайл · 2.0 МБ». Векторная без данных — пустая строка (строку задаёт вызывающий).
 */
export function mapSummary(m: MapSource): string {
  if (m.kind === 'vector')
    return m.ohm ? `${countRu(m.ohm.features, 'объект', 'объекта', 'объектов')} · ${fmtBytes(m.stats?.bytes)} · данные на ${fmtDay(m.ohm.fetchedAt)}` : '';
  return `${m.date ? `${m.date} · ` : ''}z${m.minzoom}–${m.maxzoom} · ${tilesText(m.stats?.tiles ?? 0)} · ${fmtBytes(m.stats?.bytes)}`;
}

/**
 * «пакет ↓»: векторная карта, данные которой ещё не загружены, пакета не имеет (служба ответит 409,
 * а в настольном приложении ссылка открыла бы страницу с JSON) — причина для подсказки; можно — null.
 */
export function packageBlocked(m: MapSource): string | null {
  return m.kind === 'vector' && !m.ohm ? 'Карта ещё не загружена' : null;
}
