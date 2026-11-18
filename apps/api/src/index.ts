import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { authorized, type AppBindings } from './access'
import { catalog } from './catalog'
import { finance } from './finance'
import { vault } from './vault'

const app = new Hono<{ Bindings: AppBindings }>()

app.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Frame-Options', 'DENY')
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
  if (new URL(c.req.url).protocol === 'https:') {
    c.header('Strict-Transport-Security', 'max-age=31536000')
  }
})

app.use('*', async (c, next) => {
  if (!(await authorized(c.req.raw, c.env))) return c.json({ error: 'Se requiere acceso del administrador.' }, 403)
  await next()
})

app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: 'Solicitud demasiado grande.' }, 413) }))
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header('Sec-Fetch-Site') === 'cross-site') {
      return c.json({ error: 'Origen de solicitud no permitido.' }, 403)
    }
    if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return c.json({ error: 'Se requiere un cuerpo JSON.' }, 415)
    }
  }
  await next()
})

app.route('/api', catalog)
app.route('/api', finance)
app.route('/api/vault', vault)
app.all('/api/*', c => c.json({ error: 'Ruta no encontrada.' }, 404))
app.get('*', async c => {
  const asset = await c.env.ASSETS.fetch(c.req.raw)
  return new Response(asset.body, asset)
})
app.onError((_error, c) => c.json({ error: 'No se pudo completar la operación.' }, 500))
export default app
