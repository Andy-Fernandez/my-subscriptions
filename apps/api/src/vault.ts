import { Hono } from 'hono'
import { secretWriteSchema, setupSchema, type SecretRecord, type VaultSettings } from '@gestor/shared/vault'

export const vault = new Hono<{ Bindings: { DB: D1Database } }>()

vault.get('/', async c => {
  const settings = await c.env.DB.prepare('SELECT salt, iv, ciphertext, version FROM vault_settings WHERE id = 1').first<VaultSettings>()
  return c.json({ settings })
})

vault.post('/', async c => {
  const input = setupSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Configuración de bóveda inválida.' }, 400)
  const { salt, iv, ciphertext } = input.data
  const { meta } = await c.env.DB.prepare('INSERT INTO vault_settings(id, salt, iv, ciphertext) VALUES(1, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(salt, iv, ciphertext).run()
  if (meta.changes !== 1) return c.json({ error: 'La bóveda ya existe. Actualiza esta vista para desbloquearla.' }, 409)
  return c.json({ ok: true }, 201)
})

vault.use('/accounts/:id', async (c, next) => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: 'Cuenta inválida.' }, 400)
  const exists = await c.env.DB.prepare('SELECT id FROM access_accounts WHERE id = ?').bind(id).first()
  if (!exists) return c.json({ error: 'Cuenta inexistente.' }, 404)
  await next()
})

vault.get('/accounts/:id', async c => {
  const secret = await c.env.DB.prepare('SELECT iv, ciphertext, revision FROM credential_secrets WHERE access_account_id = ?')
    .bind(Number(c.req.param('id'))).first<SecretRecord>()
  return c.json({ secret })
})

vault.put('/accounts/:id', async c => {
  const id = Number(c.req.param('id'))
  const input = secretWriteSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Contraseña cifrada inválida.' }, 400)
  const { iv, ciphertext, revision } = input.data
  const stmt = revision === 0
    ? c.env.DB.prepare('INSERT INTO credential_secrets(access_account_id, iv, ciphertext) SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM vault_settings) ON CONFLICT(access_account_id) DO NOTHING').bind(id, iv, ciphertext)
    : c.env.DB.prepare('UPDATE credential_secrets SET iv = ?, ciphertext = ?, revision = revision + 1 WHERE access_account_id = ? AND revision = ?').bind(iv, ciphertext, id, revision)
  const result = await stmt.run()
  if (result.meta.changes !== 1) return c.json({ error: 'La bóveda cambió. Vuelve a abrir esta cuenta antes de guardar.' }, 409)
  return c.json({ revision: revision + 1 })
})
