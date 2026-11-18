import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { CatalogData } from '@gestor/shared/catalog'
import { catalog } from '../src/catalog.ts'
import { createTestDatabase } from './sqlite-d1.ts'

function setup(t: TestContext) {
  const { sqlite, DB } = createTestDatabase(t, ['0001_catalog.sql', '0004_catalog_active.sql'])

  async function request<T = { id: number }>(path: string, body?: object, method = body ? 'POST' : 'GET') {
    const response = await catalog.request(path, {
      method,
      body: body && JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }, { DB })
    return { status: response.status, body: await response.json() as T }
  }

  function populate() {
    sqlite.exec(`
      INSERT INTO services (id, name) VALUES (1, 'Netflix'), (2, 'Disney+'), (3, 'YouTube');
      INSERT INTO people (id, name) VALUES (1, 'Mara'), (2, 'José');
      INSERT INTO subscriptions (id, service_id, name) VALUES (1, 1, 'Plan familiar'), (2, 2, 'Plan familiar'), (3, 3, 'Plan familiar');
    `)
  }

  return { request, populate }
}

test('una identidad se comparte entre servicios y conserva sus vínculos al desactivarse', async (t) => {
  const { request } = setup(t)
  const netflix = (await request('/services', { name: ' Netflix ' })).body.id
  const disney = (await request('/services', { name: 'Disney+' })).body.id
  assert.equal((await request('/services', { name: 'netflix' })).status, 409)
  assert.equal((await request('/access-accounts', { name: 'Personal', login: 'uno@example.com', password: 'fuera del catálogo' })).status, 400)

  const shared = (await request('/access-accounts', { name: 'Personal', login: 'uno@example.com' })).body.id
  const second = (await request('/access-accounts', { name: 'Familia', login: 'otro@example.com' })).body.id
  for (const plan of [
    { service_id: netflix, access_account_id: shared, name: 'Casa' },
    { service_id: disney, access_account_id: shared, name: 'Casa' },
    { service_id: netflix, access_account_id: second, name: 'Familia' },
  ]) {
    assert.equal((await request('/subscriptions', plan)).status, 201)
  }

  assert.equal((await request(`/access-accounts/${shared}/state`, { active: 0 }, 'PATCH')).status, 200)
  assert.equal((await request('/subscriptions', { service_id: netflix, access_account_id: shared, name: 'Otros' })).status, 409)
  const { body } = await request<CatalogData>('/catalog')
  assert.equal(body.access_accounts.find((account) => account.id === shared)?.active, 0)
  assert.equal(body.subscriptions.filter((subscription) => subscription.access_account_id === shared).length, 2)
  assert.equal(body.subscriptions.filter((subscription) => subscription.service_id === netflix).length, 2)
  const existing = body.subscriptions.find((subscription) => subscription.access_account_id === shared)
  assert.ok(existing)
  assert.equal((await request(`/subscriptions/${existing.id}`, { name: 'Hogar', access_account_id: shared }, 'PATCH')).status, 200)
})

test('trasladar preserva el historial y el retiro previsto, con reversión si hay superposición', async (t) => {
  const { request, populate } = setup(t)
  populate()
  const original = await request('/memberships', {
    person_id: 1, subscription_id: 1, start_date: '2025-01-01', end_date: '2025-06-01',
  })
  assert.equal(original.status, 201)
  assert.equal((await request('/memberships', {
    person_id: 1, subscription_id: 2, start_date: '2025-02-01', end_date: '2025-03-01',
  })).status, 201)
  const destination = `/memberships/${original.body.id}/move`
  assert.equal((await request(destination, { subscription_id: 2, start_date: '2025-02-10' })).status, 409)
  const rollback = (await request<CatalogData>('/catalog')).body
  assert.equal(rollback.memberships.find((membership) => membership.id === original.body.id)?.end_date, '2025-06-01')

  const moved = await request(destination, { subscription_id: 2, start_date: '2025-03-01' })
  assert.equal(moved.status, 201)
  const { body: after } = await request<CatalogData>('/catalog')
  assert.equal(after.memberships.find((membership) => membership.id === original.body.id)?.end_date, '2025-03-01')
  assert.deepEqual(after.memberships.find((membership) => membership.id === moved.body.id), {
    id: moved.body.id, person_id: 1, subscription_id: 2, start_date: '2025-03-01', end_date: '2025-06-01',
  })
  assert.equal((await request('/memberships', { person_id: 1, subscription_id: 1, start_date: '2025-02-29' })).status, 400)
  assert.equal((await request('/services/2/state', { active: 0 }, 'PATCH')).status, 200)
  assert.equal((await request('/memberships', { person_id: 2, subscription_id: 2, start_date: '2025-02-28' })).status, 409)
  assert.equal((await request(`/memberships/${moved.body.id}/end`, { end_date: '2025-04-01' })).status, 200)
})

test('cada costo queda en su propia vigencia y repetir una operación no agrega otra versión', async (t) => {
  const { request, populate } = setup(t)
  populate()
  const path = '/subscriptions/1/costs'
  const first = await request(path, { start_date: '2025-01-01', amount_cents: 4200 })
  const second = await request(path, { start_date: '2025-05-01', amount_cents: 5400 })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.deepEqual(await request(path, { start_date: '2025-05-01', amount_cents: 5400 }), { ...second, status: 200 })
  assert.equal((await request(path, { start_date: '2025-04-30', amount_cents: 5000 })).status, 409)
  const { body } = await request<CatalogData>('/catalog')
  assert.deepEqual(body.service_cost_history, [
    { id: second.body.id, subscription_id: 1, start_date: '2025-05-01', end_date: null, amount_cents: 5400 },
    { id: first.body.id, subscription_id: 1, start_date: '2025-01-01', end_date: '2025-05-01', amount_cents: 4200 },
  ])
})

test('las versiones de un combo conservan los importes anteriores y se guardan atómicamente', async (t) => {
  const { request, populate } = setup(t)
  populate()
  const original = {
    name: 'Combo de casa', person_id: 1, start_date: '2025-01-01', amount_cents: 4000,
    items: [{ subscription_id: 1, amount_cents: 1200 }, { subscription_id: 2, amount_cents: 2800 }],
  }
  assert.equal((await request('/agreements', { ...original, amount_cents: 3000 })).status, 400)
  const initial = await request('/agreements', original)
  assert.equal(initial.status, 201)
  assert.equal((await request('/agreements', {
    name: 'Otro plan', person_id: 1, start_date: '2025-01-01', amount_cents: 1000,
    items: [{ subscription_id: 3, amount_cents: 1000 }],
  })).status, 201)

  const path = `/agreements/${initial.body.id}/versions`
  const revision = { ...original, start_date: '2025-06-01', amount_cents: 6000 }
  assert.equal((await request(path, {
    ...revision,
    items: [{ subscription_id: 1, amount_cents: 4000 }, { subscription_id: 3, amount_cents: 2000 }],
  })).status, 409)
  const before = (await request<CatalogData>('/catalog')).body
  assert.equal(before.agreements.find((agreement) => agreement.id === initial.body.id)?.end_date, null)
  assert.equal(before.agreements.length, 2)

  const updated = await request(path, {
    ...revision,
    items: [{ subscription_id: 1, amount_cents: 6000 }, { subscription_id: 2, amount_cents: 0 }],
  })
  assert.equal(updated.status, 201)
  const { body: after } = await request<CatalogData>('/catalog')
  assert.equal(after.agreements.find((agreement) => agreement.id === updated.body.id)?.previous_agreement_id, initial.body.id)
  assert.equal(after.agreements.find((agreement) => agreement.id === initial.body.id)?.end_date, '2025-06-01')
  const storedShares = after.agreement_items.filter((item) => item.agreement_id === initial.body.id)
  assert.deepEqual(storedShares, original.items.map((item) => ({ ...item, agreement_id: initial.body.id })))
  assert.equal(after.agreement_items.filter((item) => item.agreement_id === updated.body.id).length, 2)
  assert.equal((await request(path, { ...original, start_date: '2025-07-01' })).status, 409)
})
