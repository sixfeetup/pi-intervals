import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    create table if not exists settings (
      key text primary key,
      value text not null,
      updated_at text not null
    );

    create table if not exists clients (
      id integer primary key,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists projects (
      id integer primary key,
      client_id integer,
      name text not null,
      active integer,
      billable integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_worktypes (
      id integer primary key,
      project_id integer not null,
      worktype_id integer,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_modules (
      id integer primary key,
      project_id integer not null,
      module_id integer,
      name text not null,
      active integer,
      raw_json text not null,
      synced_at text not null
    );

    create table if not exists project_defaults (
      project_id integer primary key,
      default_worktype_id integer,
      default_module_id integer,
      updated_at text not null
    );

    create table if not exists timers (
      local_id text primary key,
      project_id integer,
      worktype_id integer,
      module_id integer,
      description text not null,
      notes text,
      started_at text not null,
      stopped_at text,
      elapsed_seconds integer not null default 0,
      state text not null check (state in ('active', 'stopped')),
      created_at text not null,
      updated_at text not null
    );

    create table if not exists time_entries (
      local_id text primary key,
      remote_id integer,
      source_timer_id text,
      project_id integer not null,
      worktype_id integer not null,
      module_id integer,
      date text not null,
      start_at text,
      end_at text,
      duration_seconds integer not null,
      description text,
      billable integer not null default 1,
      sync_status text not null check (sync_status in ('pending', 'synced', 'failed', 'needs_review')),
      sync_attempts integer not null default 0,
      last_sync_error text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_timers_state on timers(state);
    create index if not exists idx_time_entries_date on time_entries(date);
    create index if not exists idx_time_entries_project on time_entries(project_id);
    create index if not exists idx_time_entries_sync on time_entries(sync_status);
  `);
}
