/** Файлы шрифтов (latin + cyrillic) для встраивания в экспорт. */
import u0 from '@fontsource/pt-sans-narrow/files/pt-sans-narrow-latin-400-normal.woff2?url';
import u1 from '@fontsource/pt-sans-narrow/files/pt-sans-narrow-cyrillic-400-normal.woff2?url';
import u2 from '@fontsource/pt-sans-narrow/files/pt-sans-narrow-latin-700-normal.woff2?url';
import u3 from '@fontsource/pt-sans-narrow/files/pt-sans-narrow-cyrillic-700-normal.woff2?url';
import u4 from '@fontsource/pt-serif/files/pt-serif-latin-400-normal.woff2?url';
import u5 from '@fontsource/pt-serif/files/pt-serif-cyrillic-400-normal.woff2?url';
import u6 from '@fontsource/pt-serif/files/pt-serif-latin-400-italic.woff2?url';
import u7 from '@fontsource/pt-serif/files/pt-serif-cyrillic-400-italic.woff2?url';
import u8 from '@fontsource/pt-serif/files/pt-serif-latin-700-normal.woff2?url';
import u9 from '@fontsource/pt-serif/files/pt-serif-cyrillic-700-normal.woff2?url';
import u10 from '@fontsource/pt-serif/files/pt-serif-latin-700-italic.woff2?url';
import u11 from '@fontsource/pt-serif/files/pt-serif-cyrillic-700-italic.woff2?url';
import u12 from '@fontsource/roboto-condensed/files/roboto-condensed-latin-400-normal.woff2?url';
import u13 from '@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-400-normal.woff2?url';
import u14 from '@fontsource/roboto-condensed/files/roboto-condensed-latin-500-normal.woff2?url';
import u15 from '@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-500-normal.woff2?url';
import u16 from '@fontsource/roboto-condensed/files/roboto-condensed-latin-700-normal.woff2?url';
import u17 from '@fontsource/roboto-condensed/files/roboto-condensed-cyrillic-700-normal.woff2?url';

export const FONT_FILES: [string, number, string, 'latin' | 'cyrillic', string][] = [
  ['PT Sans Narrow', 400, 'normal', 'latin', u0],
  ['PT Sans Narrow', 400, 'normal', 'cyrillic', u1],
  ['PT Sans Narrow', 700, 'normal', 'latin', u2],
  ['PT Sans Narrow', 700, 'normal', 'cyrillic', u3],
  ['PT Serif', 400, 'normal', 'latin', u4],
  ['PT Serif', 400, 'normal', 'cyrillic', u5],
  ['PT Serif', 400, 'italic', 'latin', u6],
  ['PT Serif', 400, 'italic', 'cyrillic', u7],
  ['PT Serif', 700, 'normal', 'latin', u8],
  ['PT Serif', 700, 'normal', 'cyrillic', u9],
  ['PT Serif', 700, 'italic', 'latin', u10],
  ['PT Serif', 700, 'italic', 'cyrillic', u11],
  ['Roboto Condensed', 400, 'normal', 'latin', u12],
  ['Roboto Condensed', 400, 'normal', 'cyrillic', u13],
  ['Roboto Condensed', 500, 'normal', 'latin', u14],
  ['Roboto Condensed', 500, 'normal', 'cyrillic', u15],
  ['Roboto Condensed', 700, 'normal', 'latin', u16],
  ['Roboto Condensed', 700, 'normal', 'cyrillic', u17],
];
