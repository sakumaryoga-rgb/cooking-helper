// supabase/seed/unit_conversions.csv(出典つきの換算の目安)から、migration 026 の投入部分を作る。
// 使い方: node scripts/build-unit-conversion-seed.mjs  (migration の「-- BEGIN SEED」〜「-- END SEED」を書き換える)
import { readFileSync, writeFileSync } from 'node:fs'

const CSV = 'supabase/seed/unit_conversions.csv'
const MIGRATION = 'supabase/migrations/026_unit_conversion_master.sql'

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) rows.push([...row, cell])
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

const lit = (v) => (v === '' || v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const num = (v) => (v === '' || v == null ? 'null' : String(Number(v)))

const rows = parseCsv(readFileSync(CSV, 'utf8'))
const values = rows
  .map(
    (r) =>
      `  (${lit(r.catalog_name)}, ${lit(r.from_unit)}, ${num(r.from_quantity)}, ${lit(r.to_unit)}, ${num(r.to_quantity)}, ${num(r.min_quantity)}, ${num(r.max_quantity)}, ${lit(r.state_key)}, ${lit(r.weight_basis)}, ${lit(r.usage_policy)}, ${lit(r.source_id)}, ${lit(r.source_url)}, ${lit(r.note)})`
  )
  .join(',\n')

const seed = `-- BEGIN SEED (scripts/build-unit-conversion-seed.mjs で ${CSV} から生成。${rows.length} 行)
insert into ingredient_catalog_unit_conversions
  (catalog_id, from_unit, from_quantity, to_unit, to_quantity, min_quantity, max_quantity, state_key, weight_basis, usage_policy, source_id, source_url, source_note)
select c.id, v.from_unit, v.from_quantity, v.to_unit, v.to_quantity, v.min_quantity, v.max_quantity, v.state_key, v.weight_basis, v.usage_policy, v.source_id, v.source_url, v.source_note
from (values
${values}
) as v(catalog_name, from_unit, from_quantity, to_unit, to_quantity, min_quantity, max_quantity, state_key, weight_basis, usage_policy, source_id, source_url, source_note)
join ingredient_catalog c on c.name = v.catalog_name and c.group_id is null
on conflict (catalog_id, from_unit, state_key, source_id) do update set
  from_quantity = excluded.from_quantity,
  to_unit = excluded.to_unit,
  to_quantity = excluded.to_quantity,
  min_quantity = excluded.min_quantity,
  max_quantity = excluded.max_quantity,
  weight_basis = excluded.weight_basis,
  usage_policy = excluded.usage_policy,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  is_active = true;
-- END SEED`

const sql = readFileSync(MIGRATION, 'utf8')
const next = sql.replace(/-- BEGIN SEED[\s\S]*-- END SEED/, seed)
if (next === sql && !sql.includes(seed)) throw new Error('migration に BEGIN SEED / END SEED がありません')
writeFileSync(MIGRATION, next)
console.log(`${rows.length} 行を ${MIGRATION} に書きました`)
