# Подсказки ударений

`stress-suggestions.json` — выборка RUAccent для слов корпуса стенда, а не подтверждённый пользовательский словарь.
Источник: https://huggingface.co/ruaccent/accentuator/tree/b78ae5ea1e62beaf138bed1865cd8c3b0b5ca855/dictionary
Лицензия MIT: `RUAccent-LICENSE.txt` (https://github.com/Den4ikAI/ruaccent/blob/main/LICENSE).
Использованы `accents.json.gz`; все ключи из `omographs.json.gz` исключены. Оставлены только записи с одним
ударением, не меняющие буквы слова. Упрощённый словарь не разрешает омографы по контексту.
Сеть и внешние модели во время работы студии не используются. Подсказка попадает в озвучку только после сохранения.

Пересборка после загрузки двух исходных gzip-файлов указанной ревизии:
`npx tsx scripts/expo-stress-suggestions.ts <accents.json.gz> <omographs.json.gz>`.
