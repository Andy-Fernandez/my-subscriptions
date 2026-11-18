import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AppBindings {
  DB: D1Database
  ASSETS: Fetcher
  ADMIN_EMAIL?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  LOCAL_DEVELOPMENT?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function isLocalDevelopment(url: URL, env: AppBindings) {
  return env.LOCAL_DEVELOPMENT === '1' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}

export async function authorized(request: Request, env: AppBindings) {
  const url = new URL(request.url)
  if (isLocalDevelopment(url, env)) return true
  if (url.protocol !== 'https:' || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return false
  const host = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase()
  if (!host || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host)) return false
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!assertion) return false
  const issuer = 'https://' + host
  let keys = keySets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
    keySets.set(issuer, keys)
  }
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'email'],
    })
    return typeof payload.email === 'string' && payload.email.toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase()
  } catch {
    return false
  }
}
