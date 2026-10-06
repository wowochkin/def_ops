/**
 * Миграции схемы картографии (накатываются сервисом при старте, см. @def-ops/db migrate).
 * Описание карты целиком хранится в jsonb (doc); охват и граница дублируются
 * геометрией PostGIS — для будущих пространственных запросов («какие карты есть
 * на этот район»). Тайлы — на диске сервиса, не в базе.
 * Применённые миграции не меняются — изменения схемы только новыми миграциями.
 */
import type { Migration } from '@def-ops/db';

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'cartography: карты и задания',
    sql: `
      create extension if not exists postgis schema public;

      create table maps (
        tenant text not null,
        id uuid not null,
        name text not null,
        kind text not null,
        doc jsonb not null,
        bounds geometry(Polygon, 4326),
        coverage geometry(Polygon, 4326),
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant, id)
      );
      create index maps_bounds on maps using gist (bounds);
      create index maps_coverage on maps using gist (coverage);

      -- задания остаются в истории и после удаления карты
      create table jobs (
        tenant text not null,
        id uuid not null,
        map_id uuid not null,
        type text not null,
        status text not null,
        doc jsonb not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant, id)
      );
      create index jobs_map on jobs (tenant, map_id);
      create index jobs_active on jobs (status) where status in ('queued', 'running');
    `,
  },
];
