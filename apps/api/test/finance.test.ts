import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Charge, Dashboard, IssuedAgreement, Payment } from '@gestor/shared/finance'
import { finance } from '../src/finance.ts'
import { createTestDatabase } from './sqlite-d1.ts'

function setup(t: TestContext) {
  const { sqlite, DB } = createTestDatabase(t, ['0001_catalog.sql', '0002_finance.sql'])
  sqlite.exec(`
    INSERT INTO people (id, name) VALUES (1, 'Ana'), (2, 'Luz');
    INSERT INTO services (id, name) VALUES (1, 'Netflix'), (2, 'Disney+'), (3, 'Otro servicio');
    INSERT INTO subscriptions (id, service_id, name) VALUES (1, 1, 'Casa'), (2, 2, 'Familia'), (3, 3, 'Extra');
  `)

  async function request<T = unknown>(path: string, data?: object) {
    const init = data === undefined ? undefined : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }
    const result = await finance.request(path, init, { DB })
    return { status: result.status, body: await result.json() as T }
  }

  return { sqlite, request }
}

test('manual postings are idempotent and partial payments cannot exceed the charge', async t => {
  const { request, sqlite } = setup(t)
  const expense = { subscription_id: 1, amount_cents: 500, paid_on: '2025-02-01', idempotency_key: crypto.randomUUID() }
  const firstExpense = await request('/expenses', expense)
  assert.equal(firstExpense.status, 201)
  assert.deepEqual(await request('/expenses', expense), { ...firstExpense, status: 200 })
  assert.equal((await request('/expenses', { ...expense, amount_cents: 600 })).status, 409)
  assert.equal((await request('/expenses', { ...expense, paid_on: '2025-02-29' })).status, 400)
  assert.equal((await request('/expenses', { ...expense, subscription_id: 99, idempotency_key: undefined })).status, 404)

  const charge = {
    person_id: 1, subscription_id: 1, amount_cents: 900, issued_on: '2025-02-01',
    due_on: '2025-02-10', idempotency_key: crypto.randomUUID(),
  }
  const opened = await request<Charge>('/charges', charge)
  assert.equal(opened.status, 201)
  assert.deepEqual(await request('/charges', charge), { ...opened, status: 200 })
  const path = `/charges/${opened.body.id}/payments`
  assert.equal((await request(path, { amount_cents: 250, received_on: '2025-01-31' })).status, 422)
  assert.equal((await request('/charges/999/payments', { amount_cents: 100, received_on: '2025-02-02' })).status, 404)

  const payment = { amount_cents: 250, received_on: '2025-02-02', idempotency_key: crypto.randomUUID() }
  const firstPayment = await request(path, payment)
  assert.equal(firstPayment.status, 201)
  assert.deepEqual(await request(path, payment), { ...firstPayment, status: 200 })
  assert.equal((await request(path, { ...payment, amount_cents: 400 })).status, 409)
  assert.equal((await request(path, { amount_cents: 651, received_on: '2025-02-03' })).status, 409)

  const competing = (amount_cents: number) => request<Payment>(path, { amount_cents, received_on: '2025-02-03' })
  const simultaneous = await Promise.all([competing(450), competing(400)])
  assert.deepEqual(simultaneous.map(item => item.status).sort(), [201, 409])
  const accepted = simultaneous.find(item => item.status === 201)
  assert.ok(accepted)
  const recordedCents = 250 + accepted.body.amount_cents
  assert.equal(sqlite.prepare('SELECT SUM(amount_cents) AS total FROM payments').get()?.total, recordedCents)
  const balance = await request<Charge[]>('/charges?pending=1&to=2025-02-04')
  assert.equal(balance.body[0].pending_cents, 900 - recordedCents)
})

test('an issued agreement keeps its distribution and service attribution across revisions', async t => {
  const { request, sqlite } = setup(t)
  sqlite.exec(`
    INSERT INTO agreements (id, person_id, name, amount_cents, start_date)
    VALUES (1, 1, 'Combo inicial', 1000, '2025-02-01'), (9, 2, 'Combo incompleto', 1000, '2025-02-01');
    INSERT INTO agreement_items (agreement_id, subscription_id, amount_cents)
    VALUES (1, 1, 600), (1, 2, 400), (1, 3, 0), (9, 1, 50);
  `)

  const issue = { issued_on: '2025-03-01', due_on: '2025-03-05' }
  assert.equal((await request('/agreements/1/issue', { issued_on: '2025-01-31' })).status, 422)
  assert.equal((await request('/agreements/2/issue', issue)).status, 404)
  assert.equal((await request('/agreements/9/issue', issue)).status, 422)

  const original = await request<IssuedAgreement>('/agreements/1/issue', issue)
  assert.equal(original.status, 201)
  assert.deepEqual(original.body.charges.map(({ amount_cents, service_id }) => [amount_cents, service_id]), [
    [600, 1], [400, 2], [0, 3],
  ])
  assert.deepEqual(await request('/agreements/1/issue', issue), { ...original, status: 200 })
  assert.equal((await request('/agreements/1/issue', { ...issue, note: 'Otro detalle' })).status, 409)
  assert.equal((await request(`/charges/${original.body.charges[2].id}/payments`, {
    amount_cents: 1, received_on: '2025-03-02',
  })).status, 409)

  sqlite.exec(`
    UPDATE agreements SET end_date = '2025-03-01' WHERE id = 1;
    INSERT INTO agreements (id, person_id, previous_agreement_id, name, amount_cents, start_date)
    VALUES (3, 1, 1, 'Combo ajustado', 2000, '2025-03-01');
    INSERT INTO agreement_items (agreement_id, subscription_id, amount_cents)
    VALUES (3, 1, 1500), (3, 2, 500);
    UPDATE subscriptions SET service_id = 3 WHERE id = 1;
  `)

  assert.equal((await request('/agreements/3/issue', issue)).status, 409)
  assert.deepEqual(await request('/agreements/1/issue', issue), { ...original, status: 200 })
  const revised = await request<IssuedAgreement>('/agreements/3/issue', { issued_on: '2025-04-01' })
  assert.equal(revised.status, 201)
  assert.deepEqual(revised.body.charges.map(({ amount_cents, service_id }) => [amount_cents, service_id]), [
    [1500, 3], [500, 2],
  ])
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM charge_batches').get()?.total, 2)
})

test('cash uses movement dates, with balances carried forward at the requested cutoff', async t => {
  const { request } = setup(t)
  const opened = await request<Charge>('/charges', { person_id: 1, subscription_id: 1, amount_cents: 1000, issued_on: '2025-01-10' })
  const path = `/charges/${opened.body.id}/payments`
  await request(path, { amount_cents: 300, received_on: '2025-01-25' })
  await request(path, { amount_cents: 200, received_on: '2025-03-02' })
  await request(path, { amount_cents: 400, received_on: '2025-04-02' })
  await request('/expenses', { subscription_id: 1, amount_cents: 240, paid_on: '2025-03-03' })
  await request('/expenses', { subscription_id: 2, amount_cents: 360, paid_on: '2025-03-03' })
  await request('/charges', { person_id: 2, subscription_id: 2, amount_cents: 150, issued_on: '2025-03-31' })
  await request('/charges', { person_id: 2, subscription_id: 2, amount_cents: 580, issued_on: '2025-04-01' })

  const range = 'from=2025-02-01&to=2025-03-31'
  const dashboard = await request(`/dashboard?${range}`)
  assert.deepEqual(dashboard.body, {
    from: '2025-02-01', to: '2025-03-31',
    income_cents: 200, expenses_cents: 600, net_cents: -400, pending_cents: 650,
    charged_cents: 150, charge_margin_cents: -450,
    monthly: [
      { month: '2025-02', income_cents: 0, expenses_cents: 0, net_cents: 0 },
      { month: '2025-03', income_cents: 200, expenses_cents: 600, net_cents: -400 },
    ],
  })
  const byService = await request<Dashboard>(`/dashboard?${range}&service_id=1`)
  assert.equal(byService.body.expenses_cents, 240)
  assert.equal(byService.body.pending_cents, 500)
  const byPerson = await request<Dashboard>(`/dashboard?${range}&person_id=1`)
  assert.equal(byPerson.body.expenses_cents, 0)
  assert.equal(byPerson.body.net_cents, 200)
  assert.equal(byPerson.body.pending_cents, 500)
  assert.deepEqual((await request(`/expenses?${range}&person_id=1`)).body, [])
  assert.equal((await request<Payment[]>(`/payments?${range}&person_id=1`)).body.length, 1)

  const balances = await request<Charge[]>('/charges?pending=1&to=2025-03-31')
  assert.deepEqual(balances.body.map(({ pending_cents }) => pending_cents), [150, 500])
  assert.equal((await request<Charge[]>(`/charges?pending=1&${range}`)).body.length, 1)
  assert.equal((await request('/dashboard?from=2025-03-31&to=2025-02-01')).status, 400)
})

test('charge margin stays separate from cash and collections of older balances', async t => {
  const { request } = setup(t)
  const charge = await request<Charge>('/charges', {
    person_id: 1, subscription_id: 1, amount_cents: 10_000, issued_on: '2025-03-01',
  })
  assert.equal(charge.status, 201)
  const payments = `/charges/${charge.body.id}/payments`
  assert.equal((await request(payments, { amount_cents: 6000, received_on: '2025-03-04' })).status, 201)
  assert.equal((await request('/expenses', { subscription_id: 1, amount_cents: 7500, paid_on: '2025-03-05' })).status, 201)
  assert.equal((await request(payments, { amount_cents: 4000, received_on: '2025-04-03' })).status, 201)

  const march = await request<Dashboard>('/dashboard?from=2025-03-01&to=2025-03-31')
  assert.equal(march.body.charged_cents, 10_000)
  assert.equal(march.body.charge_margin_cents, 2500)
  assert.equal(march.body.net_cents, -1500)
  assert.equal(march.body.pending_cents, 4000)

  const april = await request<Dashboard>('/dashboard?from=2025-04-01&to=2025-04-30')
  assert.equal(april.body.charged_cents, 0)
  assert.equal(april.body.charge_margin_cents, 0)
  assert.equal(april.body.net_cents, 4000)
  assert.equal(april.body.pending_cents, 0)
})
