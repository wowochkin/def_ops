function normalize(value) {
  return value.toLocaleLowerCase('ru').replace(/[^0-9a-zа-яё]+/g, ' ').trim();
}

function bigrams(value) {
  const text = normalize(value);
  const result = new Map();
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2);
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

export function textSimilarity(left, right) {
  const a = bigrams(left), b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0, totalA = 0, totalB = 0;
  for (const value of a.values()) totalA += value;
  for (const value of b.values()) totalB += value;
  for (const [gram, count] of a) overlap += Math.min(count, b.get(gram) ?? 0);
  return 2 * overlap / (totalA + totalB);
}

export function bestSourcePage(description, pageTexts) {
  const words = new Set(normalize(description).split(' ').filter(word => word.length > 2));
  let best = { page: null, score: 0 };
  for (const [index, text] of pageTexts.entries()) {
    const pageWords = new Set(normalize(text).split(' '));
    const score = [...words].filter(word => pageWords.has(word)).length / Math.max(1, words.size);
    if (score > best.score) best = { page: index + 1, score };
  }
  return best.page;
}

function sourcePositionScore(group, entry) {
  if (group.sourceTop === null || group.sourceBottom === null || group.page === null) return 0;
  if (entry.page === group.page) {
    if (entry.y >= group.sourceTop - 12 && entry.y <= group.sourceBottom + 4) return 0.38;
    const distance = entry.y < group.sourceTop ? group.sourceTop - entry.y : entry.y - group.sourceBottom;
    return -Math.min(0.35, distance / 200);
  }
  if (entry.page === group.page + 1 && entry.y < 110 && group.sourceBottom > 650) return 0.3;
  return -0.2;
}

export function alignSourceGroups(entries, groups) {
  const entryCount = entries.length, groupCount = groups.length;
  const dp = Array.from({ length: entryCount + 1 }, () => Array(groupCount + 1).fill(-Infinity));
  const back = new Map();
  dp[0][0] = 0;
  for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
    dp[0][groupIndex] = dp[0][groupIndex - 1] - 0.03;
    back.set(`0:${groupIndex}`, { entries: 0, groups: 0, count: 0 });
  }
  for (let usedEntries = 1; usedEntries <= entryCount; usedEntries += 1) {
    for (let usedGroups = 1; usedGroups <= groupCount; usedGroups += 1) {
      let best = dp[usedEntries][usedGroups - 1] - 0.03;
      let previous = { entries: usedEntries, groups: usedGroups - 1, count: 0 };
      const group = groups[usedGroups - 1];
      for (let count = 1; count <= 3 && count <= usedEntries; count += 1) {
        const assigned = entries.slice(usedEntries - count, usedEntries);
        if (count > 1 && assigned.some(entry => sourcePositionScore(group, entry) < 0)) continue;
        const score = textSimilarity(group.text, assigned.map(entry => entry.text).join(' '))
          + assigned.reduce((sum, entry) => sum + sourcePositionScore(group, entry), 0) / count
          - 0.04 * (count - 1);
        const candidate = dp[usedEntries - count][usedGroups - 1] + score;
        if (candidate > best) {
          best = candidate;
          previous = { entries: usedEntries - count, groups: usedGroups - 1, count };
        }
      }
      dp[usedEntries][usedGroups] = best;
      back.set(`${usedEntries}:${usedGroups}`, previous);
    }
  }
  if (!Number.isFinite(dp[entryCount][groupCount])) throw new Error('Не удалось согласовать исходные строки и номера');
  const result = [];
  let entriesLeft = entryCount, groupsLeft = groupCount;
  while (groupsLeft > 0) {
    const previous = back.get(`${entriesLeft}:${groupsLeft}`);
    if (!previous) throw new Error('Нарушена трассировка соответствия исходных строк');
    if (previous.count) result.push({ group: groups[groupsLeft - 1], entries: entries.slice(previous.entries, entriesLeft) });
    entriesLeft = previous.entries;
    groupsLeft = previous.groups;
  }
  return result.reverse();
}
