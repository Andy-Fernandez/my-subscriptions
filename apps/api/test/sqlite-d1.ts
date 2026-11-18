import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { TestContext } from 'node:test'

export function createTestDatabase(t: TestContext, migrations: string[]) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  for (const name of migrations) {
    sqlite.exec(readFileSync(new URL(`../../../database/migrations/${name}`, import.meta.url), 'utf8'))
  }

  function prepare(sql: string) {
    const statement = sqlite.prepare(sql)
    const selectsRows = statement.columns().length > 0
    function bind(...params: SQLInputValue[]) {
      function all() {
        if (selectsRows) return { results: statement.all(...params), meta: { changes: 0, last_row_id: 0 } }
        const result = statement.run(...params)
        return {
          results: [],
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        }
      }
      return { all, run: all, first: () => statement.get(...params) ?? null }
    }
    return { ...bind(), bind }
  }

  const DB = {
    prepare,
    batch(statements: ReturnType<ReturnType<typeof prepare>['bind']>[]) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map((statement) => statement.all())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }

  return { sqlite, DB }
}
