export type OfflineDataSet = Readonly<{
  id: string;
  kind: 'FONT' | 'LIBRARY' | 'ATLAS' | 'WEATHER' | 'PDF_GENERATOR' | 'DOCX_GENERATOR' | 'SYMBOLS' | 'REFERENCE';
  name: string;
  source: string;
  version: string;
  license: string;
  sha256: string;
  attribution: string;
  offlineReady: boolean;
  autonomousArchive: 'ALLOWED' | 'LINK_ONLY' | 'FORBIDDEN';
}>;

export function createExportEnvelope(input: {
  schemaVersion: string;
  content: unknown;
  legend: readonly string[];
  units: Readonly<Record<string, string>>;
  attribution: string;
  revision: number;
  pageCount: number;
}) {
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1) throw new Error('Экспорт должен содержать хотя бы одну страницу');
  return {
    schemaVersion: input.schemaVersion,
    content: structuredClone(input.content),
    legend: [...input.legend],
    units: { ...input.units },
    attribution: input.attribution,
    revision: input.revision,
    pageNumbers: Array.from({ length: input.pageCount }, (_, index) => index + 1),
    generatedLocally: true,
  } as const;
}

export function assertAutonomousExport(datasets: readonly OfflineDataSet[], options: { allowLinkOnly?: boolean } = {}): {
  autonomous: boolean;
  warnings: string[];
} {
  if (datasets.some(dataset => !dataset.offlineReady || dataset.autonomousArchive === 'FORBIDDEN')) {
    throw new Error('Включение набора данных в автономный архив запрещено лицензией или отсутствием локальных данных');
  }
  const linkOnly = datasets.filter(dataset => dataset.autonomousArchive === 'LINK_ONLY');
  if (linkOnly.length && !options.allowLinkOnly) {
    throw new Error('Полная автономность невозможна; разрешён только экспорт ссылки/стиля');
  }
  return {
    autonomous: linkOnly.length === 0,
    warnings: linkOnly.map(dataset => `${dataset.name}: полностью автономное воспроизведение невозможно, экспортирована ссылка/стиль`),
  };
}
