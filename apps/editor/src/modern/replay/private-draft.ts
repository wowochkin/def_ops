import type { Decision, Side, sideReview } from './session';

type Draft = {
  country: string;
  choice?: string | null;
  format: NonNullable<Decision['format']>;
  note: string;
  materialIds: string[];
};

export function draftKey(sessionId: string | undefined, side: Side, at: string) {
  return sessionId ? 'def_ops.modern.replay.draft.v1/' + encodeURIComponent(sessionId) + '/' + side + '/' + at : null;
}

export function readDraft(key: string | null, view: ReturnType<typeof sideReview>): Draft {
  let data: Partial<Draft> = {};
  if (key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw && JSON.parse(raw);
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch { /* Открываем личную форму с исходными значениями. */ }
  }
  const country = view.initialCountry ?? view.countryOptions.find(option => option.country === data.country)?.country ?? view.profile.country;
  const catalog = view.countryOptions.find(option => option.country === country)?.materials ?? [];
  const optional = Array.isArray(data.materialIds) ? data.materialIds : [];
  const materialIds = view.initialMaterialIds ?? catalog.filter(item => item.required || optional.includes(item.id)).map(item => item.id);
  return {
    country,
    choice: data.choice === null || view.choices.some(item => item.id === data.choice) ? data.choice : undefined,
    format: data.format === 'separate' ? 'separate' : 'directive',
    note: typeof data.note === 'string' ? data.note : '',
    materialIds: [...materialIds],
  };
}

export function writeDraft(key: string | null, draft: Draft) {
  if (!key) return true;
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string | null) {
  if (key) {
    try { localStorage.removeItem(key); } catch { /* Сданную запись нельзя снова открыть как черновик. */ }
  }
}
