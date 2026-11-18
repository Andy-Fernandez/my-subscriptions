import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountContext, decrypt, deriveKey, encrypt, randomBase64, verifierText } from '../../web/src/vault-crypto'
import { authorized, type AppBindings } from '../src/access'
import app from '../src/index'
import { createTestDatabase } from './sqlite-d1'

test('Access protege archivos y datos por defecto y limita la excepción local a loopback', async () => {
  const dev = { LOCAL_DEVELOPMENT: '1' } as AppBindings
  assert.equal(await authorized(new Request('http://127.0.0.1/'), dev), true)
  assert.equal(await authorized(new Request('https://privado.example/'), dev), false)
  const unauthenticated = { ASSETS: { fetch: () => new Response('html') } } as unknown as AppBindings
  for (const path of ['/api/catalog', '/', '/sw.js']) {
    const response = await app.request('https://privado.example' + path, {}, unauthenticated)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
  const response = await app.request('http://localhost/', {}, { ...unauthenticated, ...dev })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.ok(response.headers.get('Content-Security-Policy'))
})

test('la bóveda vincula cada cifrado a su cuenta y rechaza cambios basados en versiones anteriores', async t => {
  const { DB, sqlite } = createTestDatabase(t, ['0001_catalog.sql', '0003_vault.sql'])
  sqlite.exec("INSERT INTO access_accounts (id, name, login) VALUES (1, 'Casa', 'usuario')")
  const env = { DB, LOCAL_DEVELOPMENT: '1' } as unknown as AppBindings
  function request(path: string, method = 'GET', data?: object) {
    return app.request('http://localhost/api/vault' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
      body: data ? JSON.stringify(data) : undefined,
    }, env)
  }
  const salt = randomBase64(16)
  const key = await deriveKey('frase exclusiva para esta prueba', salt)
  const wrongKey = await deriveKey('otra frase independiente de prueba', salt)
  const verifier = await encrypt(key, verifierText, verifierText)
  const settings = { salt, version: 1, ...verifier }
  assert.equal((await request('', 'POST', settings)).status, 201)
  assert.equal((await request('', 'POST', settings)).status, 409)
  assert.equal(await decrypt(key, verifier, verifierText), verifierText)
  await assert.rejects(() => decrypt(wrongKey, verifier, verifierText))

  const plaintext = 'ejemplo-de-prueba'
  const secret = await encrypt(key, plaintext, accountContext(1))
  const another = await encrypt(key, plaintext, accountContext(1))
  assert.notEqual(secret.iv, another.iv)
  assert.equal((await request('/accounts/1', 'PUT', { ...secret, revision: 0 })).status, 200)
  assert.equal((await request('/accounts/1', 'PUT', { ...another, revision: 0 })).status, 409)
  const { secret: stored } = await (await request('/accounts/1')).json() as { secret: typeof secret & {revision: number} }
  assert.equal(stored.revision, 1)
  assert.equal(await decrypt(key, stored, accountContext(1)), plaintext)
  await assert.rejects(() => decrypt(key, stored, accountContext(2)))
  assert.equal((await request('/accounts/1', 'PUT', { ...another, revision: 1 })).status, 200)
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM credential_secrets').all()).includes(plaintext))
})
