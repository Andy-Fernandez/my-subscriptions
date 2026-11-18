import { Hono } from 'hono'
import {
  chargeInputSchema,
  expenseInputSchema,
  financeFiltersSchema,
  issueAgreementInputSchema,
  paymentInputSchema,
  type Charge,
  type Dashboard,
  type Expense,
  type FinanceFilters,
  type IssuedAgreement,
  type MonthlyCash,
  type Payment,
} from '@gestor/shared/finance'

export const finance = new Hono<{ Bindings: { DB: D1Database } }>()

const financeErrors = [
  ['finance_agreement_missing', 'No se encontró el acuerdo.', 404],
  ['finance_agreement_inactive', 'El acuerdo no está vigente en la fecha de emisión.', 422],
  ['finance_agreement_distribution', 'La distribución del acuerdo no coincide con su precio.', 422],
  ['finance_agreement_already_issued', 'Ya se emitió un acuerdo para esta persona y suscripción en esa fecha.', 409],
  ['finance_charge_missing', 'No se encontró el cargo.', 404],
  ['finance_payment_before_charge', 'La fecha de cobro debe ser igual o posterior a la del cargo.', 422],
  ['finance_payment_over_balance', 'El cobro supera el saldo pendiente del cargo.', 409],
] as const

finance.onError((error, c) => {
  const details = `${error.message} ${error.cause ?? ''}`
  const failure = financeErrors.find(([code]) => details.includes(code))
  if (failure) return c.json({ error: failure[1] }, failure[2])
  throw error
})

const validationMessage = (error: { issues: readonly { message: string }[] }) => ({
  error: error.issues[0]?.message ?? 'Revisa los datos ingresados.',
})

const idempotencyConflict = { error: 'Esta operación ya fue registrada con otros datos.' }

const localDate = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/La_Paz',
})

function today() {
  const parts = new Map(localDate.formatToParts(new Date()).map(part => [part.type, part.value]))
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`
}

function pathId(value: string) {
  const id = Number(value)
  return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null
}

function timeAndEntityFilters(filters: FinanceFilters) {
  return [filters.from ?? null, filters.to ?? null, filters.service_id ?? null, filters.person_id ?? null] as const
}

const expenseDetails = `
  SELECT e.id, e.subscription_id, s.name AS subscription_name,
    e.service_id, service.name AS service_name, e.amount_cents, e.paid_on, e.note
  FROM expenses AS e
  JOIN subscriptions AS s ON s.id = e.subscription_id
  JOIN services AS service ON service.id = e.service_id
`

const paymentDetails = `
  SELECT payment.id, payment.charge_id, payment.amount_cents, payment.received_on, payment.note,
    c.person_id, person.name AS person_name, c.subscription_id, s.name AS subscription_name,
    c.service_id, service.name AS service_name
  FROM payments AS payment
  JOIN charges AS c ON c.id = payment.charge_id
  JOIN people AS person ON person.id = c.person_id
  JOIN subscriptions AS s ON s.id = c.subscription_id
  JOIN services AS service ON service.id = c.service_id
`

const paidAtCutoff = `COALESCE((
  SELECT SUM(payment.amount_cents) FROM payments AS payment
  WHERE payment.charge_id = c.id AND (?1 IS NULL OR payment.received_on <= ?1)
), 0)`

function chargeDetails(condition: string) {
  return `
    WITH balances AS (
      SELECT c.id, c.person_id, person.name AS person_name, c.subscription_id,
        s.name AS subscription_name, c.service_id, service.name AS service_name,
        c.amount_cents, c.issued_on, c.due_on, c.note, c.charge_batch_id, batch.agreement_id,
        ${paidAtCutoff} AS paid_cents
      FROM charges AS c
      JOIN people AS person ON person.id = c.person_id
      JOIN subscriptions AS s ON s.id = c.subscription_id
      JOIN services AS service ON service.id = c.service_id
      LEFT JOIN charge_batches AS batch ON batch.id = c.charge_batch_id
      WHERE ${condition}
    )
    SELECT *, amount_cents - paid_cents AS pending_cents FROM balances
  `
}

finance.get('/expenses', async c => {
  const filters = financeFiltersSchema.safeParse(c.req.query())
  if (!filters.success) return c.json(validationMessage(filters.error), 400)
  if (filters.data.person_id !== undefined) return c.json([] as Expense[])

  const expenses = await c.env.DB.prepare(`
    ${expenseDetails}
    WHERE (?1 IS NULL OR e.paid_on >= ?1) AND (?2 IS NULL OR e.paid_on <= ?2)
      AND (?3 IS NULL OR e.service_id = ?3)
    ORDER BY e.paid_on DESC, e.id DESC
  `).bind(filters.data.from ?? null, filters.data.to ?? null, filters.data.service_id ?? null).all<Expense>()
  return c.json(expenses.results)
})

finance.post('/expenses', async c => {
  const input = expenseInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json(validationMessage(input.error), 400)
  const { subscription_id, amount_cents, paid_on, note } = input.data
  const key = input.data.idempotency_key ?? crypto.randomUUID()
  const db = c.env.DB
  const [written, found] = await db.batch<Expense>([
    db.prepare(`
      INSERT INTO expenses (subscription_id, service_id, amount_cents, paid_on, note, idempotency_key)
      SELECT s.id, s.service_id, ?2, ?3, ?4, ?5 FROM subscriptions AS s
      WHERE s.id = ?1 AND NOT EXISTS (SELECT 1 FROM expenses WHERE idempotency_key = ?5)
    `).bind(subscription_id, amount_cents, paid_on, note, key),
    db.prepare(`${expenseDetails} WHERE e.idempotency_key = ?1`).bind(key),
  ])

  const expense = found?.results[0]
  if (!expense) return c.json({ error: 'No se encontró la suscripción.' }, 404)
  if (expense.subscription_id !== subscription_id || expense.amount_cents !== amount_cents ||
      expense.paid_on !== paid_on || expense.note !== note) {
    return c.json(idempotencyConflict, 409)
  }
  return c.json(expense, written?.meta.changes ? 201 : 200)
})

finance.get('/charges', async c => {
  const filters = financeFiltersSchema.safeParse(c.req.query())
  if (!filters.success) return c.json(validationMessage(filters.error), 400)
  const { from, to, service_id, person_id, pending } = filters.data
  const cutoff = to ?? (pending === '1' ? today() : null)
  if (from && cutoff && from > cutoff) {
    return c.json({ error: 'El final del periodo debe ser igual o posterior al inicio.' }, 400)
  }

  const charges = await c.env.DB.prepare(`
    ${chargeDetails(`
      (?1 IS NULL OR c.issued_on <= ?1) AND (?2 IS NULL OR c.issued_on >= ?2)
      AND (?3 IS NULL OR c.service_id = ?3) AND (?4 IS NULL OR c.person_id = ?4)
    `)}
    WHERE (?5 = 0 OR amount_cents > paid_cents)
    ORDER BY issued_on DESC, id DESC
  `).bind(cutoff, from ?? null, service_id ?? null, person_id ?? null, pending === '1' ? 1 : 0).all<Charge>()
  return c.json(charges.results)
})

finance.post('/charges', async c => {
  const input = chargeInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json(validationMessage(input.error), 400)
  const { person_id, subscription_id, amount_cents, issued_on, due_on, note } = input.data
  const key = input.data.idempotency_key ?? crypto.randomUUID()
  const db = c.env.DB
  const [written, found] = await db.batch<Charge>([
    db.prepare(`
      INSERT INTO charges (person_id, subscription_id, service_id, amount_cents, issued_on, due_on, note, idempotency_key)
      SELECT person.id, s.id, s.service_id, ?3, ?4, ?5, ?6, ?7
      FROM people AS person CROSS JOIN subscriptions AS s
      WHERE person.id = ?1 AND s.id = ?2
        AND NOT EXISTS (SELECT 1 FROM charges WHERE idempotency_key = ?7)
    `).bind(person_id, subscription_id, amount_cents, issued_on, due_on, note, key),
    db.prepare(chargeDetails('c.idempotency_key = ?2')).bind(null, key),
  ])

  const charge = found?.results[0]
  if (!charge) return c.json({ error: 'No se encontró la persona o la suscripción.' }, 404)
  if (charge.person_id !== person_id || charge.subscription_id !== subscription_id ||
      charge.amount_cents !== amount_cents || charge.issued_on !== issued_on ||
      charge.due_on !== due_on || charge.note !== note) {
    return c.json(idempotencyConflict, 409)
  }
  return c.json(charge, written?.meta.changes ? 201 : 200)
})

finance.get('/payments', async c => {
  const filters = financeFiltersSchema.safeParse(c.req.query())
  if (!filters.success) return c.json(validationMessage(filters.error), 400)

  const payments = await c.env.DB.prepare(`
    ${paymentDetails}
    WHERE (?1 IS NULL OR payment.received_on >= ?1) AND (?2 IS NULL OR payment.received_on <= ?2)
      AND (?3 IS NULL OR c.service_id = ?3) AND (?4 IS NULL OR c.person_id = ?4)
    ORDER BY payment.received_on DESC, payment.id DESC
  `).bind(...timeAndEntityFilters(filters.data)).all<Payment>()
  return c.json(payments.results)
})

finance.post('/charges/:id/payments', async c => {
  const chargeId = pathId(c.req.param('id'))
  if (!chargeId) return c.json({ error: 'El identificador del cargo no es válido.' }, 400)
  const input = paymentInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json(validationMessage(input.error), 400)
  const { amount_cents, received_on, note } = input.data
  const key = input.data.idempotency_key ?? crypto.randomUUID()
  const db = c.env.DB
  const [written, found] = await db.batch<Payment>([
    db.prepare(`
      INSERT INTO payments (charge_id, amount_cents, received_on, note, idempotency_key)
      SELECT ?1, ?2, ?3, ?4, ?5
      WHERE NOT EXISTS (SELECT 1 FROM payments WHERE idempotency_key = ?5)
    `).bind(chargeId, amount_cents, received_on, note, key),
    db.prepare(`${paymentDetails} WHERE payment.idempotency_key = ?1`).bind(key),
  ])

  const payment = found?.results[0]
  if (!payment) throw new Error('El cobro registrado no se pudo leer.')
  if (payment.charge_id !== chargeId || payment.amount_cents !== amount_cents ||
      payment.received_on !== received_on || payment.note !== note) {
    return c.json(idempotencyConflict, 409)
  }
  return c.json(payment, written?.meta.changes ? 201 : 200)
})

interface ChargeBatch {
  id: number
  agreement_id: number
  issued_on: string
  due_on: string | null
  note: string | null
}

finance.post('/agreements/:id/issue', async c => {
  const agreementId = pathId(c.req.param('id'))
  if (!agreementId) return c.json({ error: 'El identificador del acuerdo no es válido.' }, 400)
  const input = issueAgreementInputSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json(validationMessage(input.error), 400)
  const { issued_on, due_on, note } = input.data
  const key = input.data.idempotency_key ?? crypto.randomUUID()
  const db = c.env.DB
  const [written, found] = await db.batch<ChargeBatch>([
    db.prepare(`
      INSERT INTO charge_batches (agreement_id, issued_on, due_on, note, idempotency_key)
      SELECT ?1, ?2, ?3, ?4, ?5
      WHERE NOT EXISTS (
        SELECT 1 FROM charge_batches WHERE idempotency_key = ?5 OR (agreement_id = ?1 AND issued_on = ?2)
      )
    `).bind(agreementId, issued_on, due_on, note, key),
    db.prepare(`
      SELECT id, agreement_id, issued_on, due_on, note FROM charge_batches
      WHERE idempotency_key = ?3 OR (agreement_id = ?1 AND issued_on = ?2)
      ORDER BY (idempotency_key = ?3) DESC LIMIT 1
    `).bind(agreementId, issued_on, key),
  ])

  const batch = found?.results[0]
  if (!batch) throw new Error('La emisión registrada no se pudo leer.')
  if (batch.agreement_id !== agreementId || batch.issued_on !== issued_on || batch.due_on !== due_on || batch.note !== note) {
    return c.json(idempotencyConflict, 409)
  }

  const charges = await db.prepare(`${chargeDetails('c.charge_batch_id = ?2')} ORDER BY id`)
    .bind(null, batch.id).all<Charge>()
  const issued: IssuedAgreement = { agreement_id: agreementId, issued_on, charges: charges.results }
  return c.json(issued, written?.meta.changes ? 201 : 200)
})

type CashRow = Omit<MonthlyCash, 'net_cents'>
type ReceivablesRow = Pick<Dashboard, 'charged_cents' | 'pending_cents'>

function completeMonths(from: string, to: string, rows: CashRow[]): MonthlyCash[] {
  const rowsByMonth = new Map(rows.map(row => [row.month, row]))
  const firstMonth = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1
  const lastMonth = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1
  const months: MonthlyCash[] = []
  for (let index = firstMonth; index <= lastMonth; index++) {
    const year = String(Math.floor(index / 12)).padStart(4, '0')
    const number = String(index % 12 + 1).padStart(2, '0')
    const month = `${year}-${number}`
    const row = rowsByMonth.get(month)
    const expenses_cents = row?.expenses_cents ?? 0
    const income_cents = row?.income_cents ?? 0
    months.push({ month, expenses_cents, income_cents, net_cents: income_cents - expenses_cents })
  }
  return months
}

finance.get('/dashboard', async c => {
  const filters = financeFiltersSchema.safeParse(c.req.query())
  if (!filters.success) return c.json(validationMessage(filters.error), 400)
  const to = filters.data.to ?? today()
  const from = filters.data.from ?? `${to.slice(0, 7)}-01`
  if (from > to) return c.json({ error: 'El final del periodo debe ser igual o posterior al inicio.' }, 400)
  const serviceId = filters.data.service_id ?? null
  const personId = filters.data.person_id ?? null
  const db = c.env.DB
  const [cash, receivables] = await db.batch<CashRow | ReceivablesRow>([
    db.prepare(`
      WITH cashflow AS (
        SELECT substr(paid_on, 1, 7) AS month, SUM(amount_cents) AS expenses_cents, 0 AS income_cents
        FROM expenses
        WHERE paid_on BETWEEN ?1 AND ?2 AND (?3 IS NULL OR service_id = ?3) AND ?4 IS NULL
        GROUP BY month
        UNION ALL
        SELECT substr(payment.received_on, 1, 7) AS month, 0 AS expenses_cents,
          SUM(payment.amount_cents) AS income_cents
        FROM payments AS payment JOIN charges AS c ON c.id = payment.charge_id
        WHERE payment.received_on BETWEEN ?1 AND ?2
          AND (?3 IS NULL OR c.service_id = ?3) AND (?4 IS NULL OR c.person_id = ?4)
        GROUP BY month
      )
      SELECT month, SUM(expenses_cents) AS expenses_cents, SUM(income_cents) AS income_cents
      FROM cashflow GROUP BY month
    `).bind(from, to, serviceId, personId),
    db.prepare(`
      SELECT COALESCE(SUM(c.amount_cents - ${paidAtCutoff}), 0) AS pending_cents,
        COALESCE(SUM(CASE WHEN c.issued_on >= ?4 THEN c.amount_cents ELSE 0 END), 0) AS charged_cents
      FROM charges AS c
      WHERE c.issued_on <= ?1 AND (?2 IS NULL OR c.service_id = ?2) AND (?3 IS NULL OR c.person_id = ?3)
    `).bind(to, serviceId, personId, from),
  ])

  const monthly = completeMonths(from, to, (cash?.results ?? []) as CashRow[])
  const expenses_cents = monthly.reduce((total, month) => total + month.expenses_cents, 0)
  const income_cents = monthly.reduce((total, month) => total + month.income_cents, 0)
  const totals = receivables?.results[0] as ReceivablesRow | undefined
  const charged_cents = totals?.charged_cents ?? 0
  const dashboard: Dashboard = {
    from, to, expenses_cents, income_cents,
    net_cents: income_cents - expenses_cents,
    charged_cents,
    charge_margin_cents: charged_cents - expenses_cents,
    pending_cents: totals?.pending_cents ?? 0,
    monthly,
  }
  return c.json(dashboard)
})
