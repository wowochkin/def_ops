/** Ограничения ввода действуют только пока открыт выставочный корень. */
export function lockdown(
  doc: Document,
  opts: { operatorCombo: (e: KeyboardEvent) => boolean; allowKey?: (e: KeyboardEvent) => boolean },
): () => void {
  const field = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  const stop = (e: Event) => {
    if (e.type === 'selectstart' && field(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const key = (e: KeyboardEvent) => {
    if (opts.operatorCombo(e)) return;
    if (field(e.target)) {
      const edit = e.metaKey || e.ctrlKey ? /^[acvxz]$/i.test(e.key) : !e.altKey && !/^F\d+$/.test(e.key);
      if (edit) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || /^F\d+$/.test(e.key)) return stop(e);
    if (opts.allowKey?.(e)) return;
    stop(e);
  };
  const wheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) stop(e);
  };
  const blocked = ['contextmenu', 'selectstart', 'dragstart', 'gesturestart'];
  blocked.forEach((name) => doc.addEventListener(name, stop, { capture: true, passive: false }));
  doc.addEventListener('keydown', key, true);
  doc.addEventListener('wheel', wheel, { capture: true, passive: false });
  doc.documentElement.classList.add('expo-active');
  return () => {
    blocked.forEach((name) => doc.removeEventListener(name, stop, true));
    doc.removeEventListener('keydown', key, true);
    doc.removeEventListener('wheel', wheel, true);
    doc.documentElement.classList.remove('expo-active');
  };
}
