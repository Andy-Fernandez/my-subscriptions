import { Hono, type Context } from 'hono'
import type { z } from 'zod'
import {
  accessAccountInput,
  agreementInput,
  catalogId,
  catalogStateInput,
  costInput,
  endDateInput,
  membershipInput,
  membershipMoveInput,
  personInput,
  serviceInput,
  subscriptionEditInput,
  subscriptionInput,
  type Membership,
} from '@gestor/shared/catalog'

type CatalogEnv = { Bindings: { DB: D1Database } }
type CatalogContext = Context<CatalogEnv>

class CatalogError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message)
  }
}

export const catalog = new Hono<CatalogEnv>()

catalog.onError((error, c) => {
  if (error instanceof CatalogError) return c.json({ error: error.message }, error.status)
  const details = [error.message, error.cause instanceof Error ? error.cause.message : ''].join(' ')
  if (details.includes('membership_overlap')) {
    return c.json({ error: 'La persona ya tiene una asignación en esa suscripción durante esas fechas.' }, 409)
  }
  if (details.includes('agreement_overlap')) {
    return c.json({ error: 'La persona ya tiene un acuerdo para una de esas suscripciones durante esas fechas.' }, 409)
  }
  if (details.includes('UNIQUE constraint failed: services.name')) {
    return c.json({ error: 'Ya existe un servicio con ese nombre.' }, 409)
  }
  if (details.includes('UNIQUE constraint failed: subscriptions.service_id')) {
    return c.json({ error: 'Ya existe una suscripción con ese nombre para el mismo servicio.' }, 409)
  }
  if (details.includes('FOREIGN KEY constraint failed')) {
    return c.json({ error: 'Uno de los registros seleccionados ya no está disponible.' }, 409)
  }
  return c.json({ error: 'No se pudo completar la operación del catálogo.' }, 500)
})

async function readBody<T extends z.ZodType>(c: CatalogContext, schema: T): Promise<z.output<T>> {
  const raw: unknown = await c.req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new CatalogError(400, parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.')
  }
  return parsed.data
}

function readId(c: CatalogContext) {
  const raw = c.req.param('id') ?? ''
  const parsed = catalogId.safeParse(Number(raw))
  if (!/^\d+$/.test(raw) || !parsed.success) throw new CatalogError(400, 'Identificador inválido.')
  return parsed.data
}

function assertUpdated(result: D1Result) {
  if (!result.meta.changes) throw new CatalogError(404, 'No se encontró el registro.')
}

catalog.get('/catalog', async (c) => {
  const db = c.env.DB
  const [services, people, accounts, subscriptions, memberships, agreements, items, costs] = await db.batch([
    db.prepare('SELECT * FROM services ORDER BY active DESC, name, id'),
    db.prepare('SELECT * FROM people ORDER BY active DESC, name, id'),
    db.prepare('SELECT * FROM access_accounts ORDER BY active DESC, name, id'),
    db.prepare('SELECT * FROM subscriptions ORDER BY active DESC, name, id'),
    db.prepare('SELECT * FROM memberships ORDER BY start_date DESC, id DESC'),
    db.prepare('SELECT * FROM agreements ORDER BY start_date DESC, id DESC'),
    db.prepare('SELECT * FROM agreement_items ORDER BY agreement_id, subscription_id'),
    db.prepare('SELECT * FROM service_cost_history ORDER BY start_date DESC, id DESC'),
  ])
  return c.json({
    services: services.results,
    people: people.results,
    access_accounts: accounts.results,
    subscriptions: subscriptions.results,
    memberships: memberships.results,
    agreements: agreements.results,
    agreement_items: items.results,
    service_cost_history: costs.results,
  })
})

catalog.post('/services', async (c) => {
  const input = await readBody(c, serviceInput)
  const result = await c.env.DB.prepare('INSERT INTO services (name, notes) VALUES (?, ?)')
    .bind(input.name, input.notes).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

catalog.patch('/services/:id', async (c) => {
  const id = readId(c)
  const input = await readBody(c, serviceInput)
  const result = await c.env.DB.prepare('UPDATE services SET name = ?, notes = ? WHERE id = ?')
    .bind(input.name, input.notes, id).run()
  assertUpdated(result)
  return c.json({ id })
})

catalog.post('/people', async (c) => {
  const input = await readBody(c, personInput)
  const result = await c.env.DB.prepare('INSERT INTO people (name, contact, notes) VALUES (?, ?, ?)')
    .bind(input.name, input.contact, input.notes).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

catalog.patch('/people/:id', async (c) => {
  const id = readId(c)
  const input = await readBody(c, personInput)
  const result = await c.env.DB.prepare('UPDATE people SET name = ?, contact = ?, notes = ? WHERE id = ?')
    .bind(input.name, input.contact, input.notes, id).run()
  assertUpdated(result)
  return c.json({ id })
})

catalog.post('/access-accounts', async (c) => {
  const input = await readBody(c, accessAccountInput)
  const result = await c.env.DB.prepare('INSERT INTO access_accounts (name, login, notes) VALUES (?, ?, ?)')
    .bind(input.name, input.login, input.notes).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

catalog.patch('/access-accounts/:id', async (c) => {
  const id = readId(c)
  const input = await readBody(c, accessAccountInput)
  const result = await c.env.DB.prepare('UPDATE access_accounts SET name = ?, login = ?, notes = ? WHERE id = ?')
    .bind(input.name, input.login, input.notes, id).run()
  assertUpdated(result)
  return c.json({ id })
})

catalog.post('/subscriptions', async (c) => {
  const input = await readBody(c, subscriptionInput)
  const result = await c.env.DB.prepare(
    `INSERT INTO subscriptions (service_id, access_account_id, name, notes)
     SELECT ?1, ?2, ?3, ?4
     WHERE EXISTS (SELECT 1 FROM services WHERE id = ?1 AND active = 1)
       AND (?2 IS NULL OR EXISTS (SELECT 1 FROM access_accounts WHERE id = ?2 AND active = 1))`,
  ).bind(input.service_id, input.access_account_id, input.name, input.notes).run()
  if (!result.meta.changes) throw new CatalogError(409, 'Selecciona un servicio y una cuenta de acceso activos.')
  return c.json({ id: result.meta.last_row_id }, 201)
})

catalog.patch('/subscriptions/:id', async (c) => {
  const id = readId(c)
  const input = await readBody(c, subscriptionEditInput)
  const result = await c.env.DB.prepare(
    `UPDATE subscriptions SET access_account_id = ?1, name = ?2, notes = ?3
     WHERE id = ?4 AND (?1 IS NULL OR access_account_id = ?1
       OR EXISTS (SELECT 1 FROM access_accounts WHERE id = ?1 AND active = 1))`,
  ).bind(input.access_account_id, input.name, input.notes, id).run()
  if (!result.meta.changes) {
    throw new CatalogError(409, 'La suscripción no está disponible o la cuenta seleccionada está inactiva.')
  }
  return c.json({ id })
})

const stateQueries = {
  services: 'UPDATE services SET active = ? WHERE id = ?',
  people: 'UPDATE people SET active = ? WHERE id = ?',
  'access-accounts': 'UPDATE access_accounts SET active = ? WHERE id = ?',
  subscriptions: 'UPDATE subscriptions SET active = ? WHERE id = ?',
}

for (const [path, sql] of Object.entries(stateQueries)) {
  catalog.patch(`/${path}/:id/state`, async (c) => {
    const id = readId(c)
    const input = await readBody(c, catalogStateInput)
    const result = await c.env.DB.prepare(sql).bind(input.active, id).run()
    assertUpdated(result)
    return c.json({ id })
  })
}

catalog.post('/memberships', async (c) => {
  const input = await readBody(c, membershipInput)
  const result = await c.env.DB.prepare(
    `INSERT INTO memberships (person_id, subscription_id, start_date, end_date)
     SELECT ?1, ?2, ?3, ?4
     WHERE EXISTS (SELECT 1 FROM people WHERE id = ?1 AND active = 1)
       AND EXISTS (SELECT 1 FROM active_subscription_ids WHERE id = ?2)`,
  ).bind(input.person_id, input.subscription_id, input.start_date, input.end_date).run()
  if (!result.meta.changes) throw new CatalogError(409, 'Selecciona una persona y una suscripción activas.')
  return c.json({ id: result.meta.last_row_id }, 201)
})

catalog.post('/memberships/:id/end', async (c) => {
  const id = readId(c)
  const input = await readBody(c, endDateInput)
  const result = await c.env.DB.prepare(
    `UPDATE memberships SET end_date = ?1
     WHERE id = ?2 AND start_date <= ?1 AND (end_date IS NULL OR end_date > ?1)`,
  ).bind(input.end_date, id).run()
  if (!result.meta.changes) {
    throw new CatalogError(409, 'La fecha de retiro debe estar dentro de la vigencia de la asignación.')
  }
  return c.json({ id })
})

catalog.post('/memberships/:id/move', async (c) => {
  const id = readId(c)
  const input = await readBody(c, membershipMoveInput)
  const db = c.env.DB
  const current = await db.prepare('SELECT * FROM memberships WHERE id = ?').bind(id).first<Membership>()
  if (!current) throw new CatalogError(404, 'No se encontró la asignación.')
  if (current.subscription_id === input.subscription_id) {
    throw new CatalogError(400, 'Elige otra suscripción para el traslado.')
  }
  if (input.start_date < current.start_date || (current.end_date && input.start_date >= current.end_date)) {
    throw new CatalogError(400, 'La fecha del traslado debe estar dentro de la vigencia de la asignación.')
  }
  const [, inserted] = await db.batch([
    db.prepare(
      `UPDATE memberships SET end_date = ?
       WHERE id = ? AND end_date IS ?
         AND EXISTS (SELECT 1 FROM people WHERE id = memberships.person_id AND active = 1)
         AND EXISTS (SELECT 1 FROM active_subscription_ids WHERE id = ?)`,
    ).bind(input.start_date, id, current.end_date, input.subscription_id),
    db.prepare(
      `INSERT INTO memberships (person_id, subscription_id, start_date, end_date)
       SELECT ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(current.person_id, input.subscription_id, input.start_date, current.end_date),
  ])
  if (!inserted.meta.changes) {
    throw new CatalogError(409, 'La asignación cambió o la persona o el destino ya no están activos.')
  }
  return c.json({ id: inserted.meta.last_row_id }, 201)
})

catalog.post('/subscriptions/:id/costs', async (c) => {
  const id = readId(c)
  const input = await readBody(c, costInput)
  const db = c.env.DB
  const [, inserted] = await db.batch([
    db.prepare(
      `UPDATE service_cost_history SET end_date = ?1
       WHERE subscription_id = ?2 AND end_date IS NULL AND start_date <= ?1
         AND (start_date <> ?1 OR amount_cents <> ?3)`,
    ).bind(input.start_date, id, input.amount_cents),
    db.prepare(
      `INSERT INTO service_cost_history (subscription_id, amount_cents, start_date)
       SELECT ?1, ?2, ?3 WHERE changes() = 1
         OR NOT EXISTS (SELECT 1 FROM service_cost_history WHERE subscription_id = ?1)`,
    ).bind(id, input.amount_cents, input.start_date),
  ])
  if (!inserted.meta.changes) {
    const matching = await db.prepare(
      'SELECT id FROM service_cost_history WHERE subscription_id = ? AND end_date IS NULL AND start_date = ? AND amount_cents = ?',
    ).bind(id, input.start_date, input.amount_cents).first<{ id: number }>()
    if (matching) return c.json(matching)
    throw new CatalogError(409, 'La fecha debe ser igual o posterior al inicio del último costo registrado.')
  }
  return c.json({ id: inserted.meta.last_row_id }, 201)
})

function insertAgreementItems(db: D1Database, items: z.output<typeof agreementInput>['items']) {
  return db.prepare(
    `INSERT INTO agreement_items (agreement_id, subscription_id, amount_cents)
     SELECT last_insert_rowid(), json_extract(value, '$.subscription_id'), json_extract(value, '$.amount_cents')
     FROM json_each(?) WHERE changes() = 1`,
  ).bind(JSON.stringify(items))
}

catalog.post('/agreements', async (c) => {
  const input = await readBody(c, agreementInput)
  const db = c.env.DB
  const [inserted] = await db.batch([
    db.prepare(
      `INSERT INTO agreements (person_id, name, amount_cents, start_date, end_date)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (SELECT 1 FROM people WHERE id = ?1 AND active = 1)
         AND NOT EXISTS (
           SELECT 1 FROM json_each(?) AS chosen
           WHERE NOT EXISTS (
             SELECT 1 FROM active_subscription_ids WHERE id = json_extract(chosen.value, '$.subscription_id')
           )
         )`,
    ).bind(input.person_id, input.name, input.amount_cents, input.start_date, input.end_date, JSON.stringify(input.items)),
    insertAgreementItems(db, input.items),
  ])
  if (!inserted.meta.changes) throw new CatalogError(409, 'Selecciona una persona y suscripciones activas.')
  return c.json({ id: inserted.meta.last_row_id }, 201)
})

catalog.post('/agreements/:id/versions', async (c) => {
  const id = readId(c)
  const input = await readBody(c, agreementInput)
  const db = c.env.DB
  const [, inserted] = await db.batch([
    db.prepare(
      `UPDATE agreements
       SET end_date = min(coalesce(end_date, ?1), ?1)
       WHERE id = ?2 AND person_id = ?3 AND start_date <= ?1
         AND NOT EXISTS (SELECT 1 FROM agreements WHERE previous_agreement_id = ?2)
         AND NOT EXISTS (
           SELECT 1 FROM json_each(?) AS chosen
           WHERE NOT EXISTS (
             SELECT 1 FROM active_subscription_ids WHERE id = json_extract(chosen.value, '$.subscription_id')
           ) AND NOT EXISTS (
             SELECT 1 FROM agreement_items
             WHERE agreement_id = ?2 AND subscription_id = json_extract(chosen.value, '$.subscription_id')
           )
         )`,
    ).bind(input.start_date, id, input.person_id, JSON.stringify(input.items)),
    db.prepare(
      `INSERT INTO agreements (person_id, previous_agreement_id, name, amount_cents, start_date, end_date)
       SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(input.person_id, id, input.name, input.amount_cents, input.start_date, input.end_date),
    insertAgreementItems(db, input.items),
  ])
  if (!inserted.meta.changes) {
    throw new CatalogError(409, 'El cambio requiere la última versión, una fecha posterior o igual a su inicio y suscripciones activas para los nuevos ítems.')
  }
  return c.json({ id: inserted.meta.last_row_id }, 201)
})

catalog.post('/agreements/:id/end', async (c) => {
  const id = readId(c)
  const input = await readBody(c, endDateInput)
  const result = await c.env.DB.prepare(
    `UPDATE agreements SET end_date = ?1
      WHERE id = ?2 AND start_date <= ?1 AND (end_date IS NULL OR end_date > ?1)
        AND NOT EXISTS (SELECT 1 FROM agreements WHERE previous_agreement_id = ?2)`,
  ).bind(input.end_date, id).run()
  if (!result.meta.changes) {
    throw new CatalogError(409, 'La fecha de cierre debe estar dentro de la vigencia de la última versión.')
  }
  return c.json({ id })
})
