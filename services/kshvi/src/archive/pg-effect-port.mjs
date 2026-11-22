import { createPool, tx } from '@def-ops/db';

export async function applyIdempotentEffect(db, effectKey, apply) {
  if (!/^[a-z_][a-z0-9_]*$/.test(db.schema)) throw new Error('Недопустимая схема эффекта');
  const pool = createPool(db.url, 1);
  try {
    return await tx(pool, async client => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`archive-effect:${db.schema}:${db.jobId}:${effectKey}`]);
      const existing = await client.query(
        `select result from ${db.schema}.archive_job_effects where job_id=$1 and effect_key=$2 for update`,
        [db.jobId, effectKey],
      );
      if (existing.rows[0]) return { effect: 'REPLAYED', value: existing.rows[0].result.value };
      await client.query(`set local search_path to ${db.schema}, public`);
      const value = await apply(client);
      await client.query(
        `insert into ${db.schema}.archive_job_effects (job_id,effect_key,result) values ($1,$2,$3)`,
        [db.jobId, effectKey, { value }],
      );
      return { effect: 'APPLIED', value };
    });
  } finally {
    await pool.end();
  }
}
