export async function idempotentEffect({ payload, effects, attempt }) {
  if (!effects) throw new Error('Требуется PostgreSQL effect port');
  const result = await effects.apply('main', async client => {
    await client.query('insert into test_side_effects(value) values ($1)', [payload.value]);
    return payload.value;
  });
  await new Promise(resolve => setTimeout(resolve, attempt > 1 ? 10 : 5000));
  return result;
}
