export function PerspectiveBadge({ perspective }: { perspective: 'PARTICIPANT' | 'TRUTH' }) {
  const truth = perspective === 'TRUTH';
  return <div
    role="status"
    aria-label="Перспектива реплея"
    style={{
      padding: '10px 14px', border: `2px solid ${truth ? '#ef9a9a' : '#80cbc4'}`,
      background: truth ? '#4a1920' : '#123b38', color: '#fff', fontWeight: 700,
    }}
  >
    {truth ? 'Истинное состояние — постоянная метка' : 'Как видел участник — сохранённая серверная проекция'}
  </div>;
}
