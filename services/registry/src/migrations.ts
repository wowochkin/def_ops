/**
 * Миграции схемы реестра (накатываются сервисом при старте, см. @def-ops/db migrate).
 * Внутри миграции search_path = <схема>, public: таблицы создаются в схеме сервиса,
 * расширения PostGIS и pg_trgm — в public (общие для всей базы).
 * Применённые миграции не меняются — изменения схемы только новыми миграциями.
 */
import type { Migration } from '@def-ops/db';

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'registry: типы, объекты, факты',
    sql: `
      create extension if not exists postgis schema public;
      create extension if not exists pg_trgm schema public;

      -- типы организации: собственные и добавленные к встроенным поля (встроенные типы — в коде)
      create table entity_types (
        tenant text not null,
        id text not null,
        name text not null,
        description text not null default '',
        fields jsonb not null default '[]',
        elements jsonb,
        builtin boolean not null default false,
        primary key (tenant, id)
      );

      create table entities (
        tenant text not null,
        id uuid not null,
        type text not null,
        name text not null,
        short_name text,
        side text,
        attrs jsonb not null default '{}',
        existence tstzrange,
        source text,
        -- наименование, краткое обозначение и номер в нижнем регистре (для поиска)
        search text not null default '',
        created_at timestamptz not null,
        updated_at timestamptz not null,
        primary key (tenant, id)
      );
      create index entities_tenant_type on entities (tenant, type);
      create index entities_search on entities using gin (search gin_trgm_ops);
      create index entities_attrs on entities using gin (attrs);
      create index entities_existence on entities using gist (existence);

      create table facts (
        tenant text not null,
        id uuid not null,
        entity_id uuid not null,
        valid tstzrange not null,                -- [validFrom, validTo)
        attrs jsonb not null default '{}',
        geom geometry(Geometry, 4326),
        source text,
        note text,
        created_at timestamptz not null,
        primary key (tenant, id),
        foreign key (tenant, entity_id) references entities (tenant, id) on delete cascade
      );
      create index facts_entity on facts (tenant, entity_id);
      create index facts_valid on facts using gist (valid);
      create index facts_geom on facts using gist (geom);
      create index facts_attrs on facts using gin (attrs);
    `,
  },
];
