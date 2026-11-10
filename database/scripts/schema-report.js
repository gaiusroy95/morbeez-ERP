#!/usr/bin/env node
/* eslint-disable no-console */
// The database as it stands, for people: an ERD per schema (Mermaid), every
// table's keys, relationships, row-level security and indexes, and an index
// review — the developer deliverables of Master Spec v3 §62. Generated from
// the live catalog, so it never drifts from the migrations:
//
//   DATABASE_URL=postgres://… node database/scripts/schema-report.js [out.md]
//
// Default output: docs/architecture/database-erd.md. Point it at a database
// migrated to the latest version (the e2e database after a reset will do).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const SKIP = ['pg_catalog', 'information_schema', 'pg_toast', 'public'];
const out = process.argv[2] ?? path.join(__dirname, '../../docs/architecture/database-erd.md');

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  try {
    const skip = SKIP.map((s) => `'${s}'`).join(', ');
    const tables = await q(`
      SELECT n.nspname AS schema, c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             obj_description(c.oid) AS comment
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN (${skip}) AND n.nspname NOT LIKE 'pg_temp%'
       ORDER BY 1, 2`);
    const columns = await q(`
      SELECT table_schema AS schema, table_name AS name, column_name AS col, data_type AS type,
             is_nullable = 'YES' AS nullable, ordinal_position AS pos
        FROM information_schema.columns
       WHERE table_schema NOT IN (${skip})
       ORDER BY 1, 2, ordinal_position`);
    const constraints = await q(`
      SELECT n.nspname AS schema, t.relname AS name, con.conname, con.contype,
             ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS cols,
             rn.nspname AS ref_schema, rt.relname AS ref_name,
             ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS ref_cols,
             con.confdeltype AS on_delete
        FROM pg_constraint con
        JOIN pg_class t ON t.oid = con.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        LEFT JOIN pg_class rt ON rt.oid = con.confrelid LEFT JOIN pg_namespace rn ON rn.oid = rt.relnamespace
       WHERE n.nspname NOT IN (${skip}) AND con.contype IN ('p', 'u', 'f')
       ORDER BY 1, 2, con.contype, con.conname`);
    const indexes = await q(`
      SELECT n.nspname AS schema, t.relname AS name, i.relname AS index, ix.indisunique AS uniq, ix.indisprimary AS pk,
             ARRAY(SELECT CASE WHEN k.attnum = 0 THEN '(expr)' ELSE a.attname::text END
                     FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
                     LEFT JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS cols,
             pg_get_expr(ix.indpred, ix.indrelid) AS predicate
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname NOT IN (${skip})
       ORDER BY 1, 2, 3`);
    const policies = await q(`SELECT schemaname AS schema, tablename AS name, policyname, cmd, roles::text AS roles FROM pg_policies WHERE schemaname NOT IN (${skip})`);

    const key = (s, n) => `${s}.${n}`;
    const by = (rows) => rows.reduce((m, r) => m.set(key(r.schema, r.name), [...(m.get(key(r.schema, r.name)) ?? []), r]), new Map());
    const colsOf = by(columns);
    const consOf = by(constraints);
    const idxOf = by(indexes);
    const polOf = by(policies);
    const schemas = [...new Set(tables.map((t) => t.schema))];

    const pkOf = (t) => (consOf.get(key(t.schema, t.name)) ?? []).find((c) => c.contype === 'p')?.cols ?? [];
    const fksOf = (t) => (consOf.get(key(t.schema, t.name)) ?? []).filter((c) => c.contype === 'f');
    const uniquesOf = (t) => (consOf.get(key(t.schema, t.name)) ?? []).filter((c) => c.contype === 'u').map((c) => c.cols);
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const isUniqueSet = (t, cols) => same(pkOf(t), cols) || uniquesOf(t).some((u) => same(u, cols)) ||
      (idxOf.get(key(t.schema, t.name)) ?? []).some((i) => i.uniq && !i.predicate && same(i.cols, cols));
    // A junction: a composite primary key made only of foreign keys (two or more tables).
    const junction = (t) => {
      const pk = pkOf(t).filter((c) => c !== 'tenant_id');
      const fkCols = new Set(fksOf(t).filter((f) => f.ref_name !== 'tenant').flatMap((f) => f.cols));
      return pk.length >= 2 && pk.every((c) => fkCols.has(c));
    };
    const relation = (t, fk) => {
      const one = isUniqueSet(t, fk.cols) || isUniqueSet(t, ['tenant_id', ...fk.cols]);
      return one ? 'one-to-one' : 'many-to-one';
    };
    // An index serves a foreign key when its leading columns are the key, or
    // tenant_id then the key (every app query carries tenant_id under RLS).
    const covered = (t, cols) =>
      (idxOf.get(key(t.schema, t.name)) ?? []).some((i) => {
        const lead = i.cols.slice(0, cols.length);
        const afterTenant = i.cols[0] === 'tenant_id' ? i.cols.slice(1, cols.length + 1) : null;
        return same(lead, cols) || (afterTenant && same(afterTenant, cols));
      });
    const DEL = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
    const ident = (s) => s.replace(/[^A-Za-z0-9_]/g, '_');

    const lines = [];
    const fkTotal = tables.reduce((n, t) => n + fksOf(t).length, 0);
    lines.push('# Database — ERD, keys and indexes', '');
    lines.push(`Generated by \`database/scripts/schema-report.js\` from the live catalog (${new Date().toISOString().slice(0, 10)}). Do not edit by hand — rerun it after a migration.`, '');
    lines.push(`**${tables.length} tables** in ${schemas.length} schemas, **${fkTotal} foreign keys**, ${indexes.length} indexes. Every table without row-level security is listed in the review below.`, '');
    lines.push('Conventions (System Architecture, Production Database): UUID primary keys; `tenant_id` on every business table, enforced by RLS (ENABLE + FORCE) with a tenant-isolation policy; money `numeric(…,2)`, quantities `numeric(…,3)` (exact — Master Spec v3 decision D5); history and events insert-only; deletes `RESTRICT`.', '');

    // ---- Review ----
    // Tables that are not one business's data, by design: the permission
    // catalogue, the tenants themselves, the global chart template.
    const GLOBAL = new Set(['identity.permission', 'tenant.tenant', 'money.ledger_account']);
    const unforced = tables.filter((t) => (!t.rls || !t.forced) && !GLOBAL.has(key(t.schema, t.name)));
    const global = tables.filter((t) => GLOBAL.has(key(t.schema, t.name)));
    const missing = [];
    for (const t of tables) for (const fk of fksOf(t)) if (fk.ref_name !== 'tenant' && !covered(t, fk.cols)) missing.push({ t, fk });
    // Who did it (→ app_user) and which journal it made (→ ledger entry): kept
    // for the audit trail, never searched from the parent, and the parents are
    // never deleted — no index needed. The rest are business relations.
    const auditLink = ({ fk }) => fk.ref_name === 'app_user' || (fk.ref_schema === 'money' && /^ledger_entr/.test(fk.ref_name));
    const business = missing.filter((m) => !auditLink(m));
    lines.push('## Review', '');
    lines.push(`### Tenant tables without forced row-level security (${unforced.length})`, '');
    lines.push(unforced.length ? unforced.map((t) => `- \`${t.schema}.${t.name}\` — RLS ${t.rls ? 'on' : 'off'}, forced ${t.forced ? 'yes' : 'no'}`).join('\n') : '- None.', '');
    lines.push('', `Global by design (no tenant): ${global.map((t) => `\`${t.schema}.${t.name}\``).join(', ')}.`, '');
    lines.push(`### Business foreign keys with no index leading on them (${business.length})`, '');
    lines.push('Leading on the key, or on `tenant_id` then the key (every app query carries `tenant_id` under RLS). Lookups from the parent scan the child without one.', '');
    lines.push(business.length ? business.map(({ t, fk }) => `- \`${t.schema}.${t.name}(${fk.cols.join(', ')})\` → \`${fk.ref_schema}.${fk.ref_name}\``).join('\n') : '- None.', '');
    lines.push('', `Not indexed on purpose: ${missing.length - business.length} audit links (who did it → \`identity.app_user\`; the journal it made → \`money.ledger_entry\`), never searched from the parent.`, '');
    const junctions = tables.filter(junction);
    lines.push(`### Many-to-many (junction) tables (${junctions.length})`, '');
    lines.push(junctions.length ? junctions.map((t) => `- \`${t.schema}.${t.name}\` joins ${fksOf(t).filter((f) => f.ref_name !== 'tenant').map((f) => `\`${f.ref_schema}.${f.ref_name}\``).join(' and ')}`).join('\n') : '- None.', '');

    // ---- Per schema ----
    for (const schema of schemas) {
      const ts = tables.filter((t) => t.schema === schema);
      lines.push(`## Schema \`${schema}\` (${ts.length} tables)`, '');
      lines.push('```mermaid', 'erDiagram');
      for (const t of ts) {
        const pk = pkOf(t);
        const fkCols = new Set(fksOf(t).flatMap((f) => f.cols));
        const shown = (colsOf.get(key(t.schema, t.name)) ?? []).filter((c) => pk.includes(c.col) || (fkCols.has(c.col) && c.col !== 'tenant_id'));
        lines.push(`  ${ident(t.name)} {`);
        for (const c of shown) lines.push(`    ${ident(c.type.split(' ')[0])} ${ident(c.col)}${pk.includes(c.col) ? ' PK' : ''}${fkCols.has(c.col) ? ' FK' : ''}`);
        lines.push('  }');
      }
      for (const t of ts) {
        for (const fk of fksOf(t)) {
          if (fk.ref_name === 'tenant' || fk.ref_name === 'app_user') continue; // every table has these; drawn they hide the rest
          const target = fk.ref_schema === schema ? ident(fk.ref_name) : ident(`${fk.ref_schema}_${fk.ref_name}`);
          const shape = relation(t, fk) === 'one-to-one' ? '|o--||' : '}o--||';
          lines.push(`  ${ident(t.name)} ${shape} ${target} : "${fk.cols.join(', ')}"`);
        }
      }
      lines.push('```', '');
      for (const t of ts) {
        const cols = colsOf.get(key(t.schema, t.name)) ?? [];
        const pol = (polOf.get(key(t.schema, t.name)) ?? []).map((p) => `${p.policyname} (${p.cmd.toLowerCase()})`);
        lines.push(`### \`${t.schema}.${t.name}\`${junction(t) ? ' — junction' : ''}`, '');
        if (t.comment) lines.push(t.comment, '');
        lines.push(`- **Primary key:** ${pkOf(t).join(', ') || '—'}`);
        const fks = fksOf(t);
        if (fks.length) lines.push(`- **References:** ${fks.map((f) => `${f.cols.join(', ')} → \`${f.ref_schema}.${f.ref_name}\` (${relation(t, f)}, on delete ${DEL[f.on_delete] ?? f.on_delete})`).join('; ')}`);
        const uniq = uniquesOf(t);
        if (uniq.length) lines.push(`- **Unique:** ${uniq.map((u) => `(${u.join(', ')})`).join('; ')}`);
        lines.push(`- **Row-level security:** ${t.rls ? (t.forced ? 'forced' : 'on, not forced') : 'off'}${pol.length ? ` — ${pol.join(', ')}` : ''}`);
        const idx = (idxOf.get(key(t.schema, t.name)) ?? []).filter((i) => !i.pk);
        if (idx.length) lines.push(`- **Indexes:** ${idx.map((i) => `${i.uniq ? 'unique ' : ''}(${i.cols.join(', ')})${i.predicate ? ` where ${i.predicate}` : ''}`).join('; ')}`);
        lines.push(`- **Columns:** ${cols.map((c) => `${c.col} ${c.type}${c.nullable ? '' : ' not null'}`).join(', ')}`, '');
      }
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n'));
    console.log(`${tables.length} tables, ${fkTotal} foreign keys, ${missing.length} unindexed, ${unforced.length} without forced RLS → ${out}`);
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
