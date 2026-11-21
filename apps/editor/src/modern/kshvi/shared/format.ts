const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatRussianDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${formatNumber(milliseconds)} мс`;
  if (milliseconds < 60_000) return `${formatNumber(milliseconds / 1000)} с`;
  return `${formatNumber(milliseconds / 60_000)} мин`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024)} КиБ`;
  if (bytes < 1024 * 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024))} МиБ`;
  return `${formatNumber(bytes / (1024 * 1024 * 1024))} ГиБ`;
}
