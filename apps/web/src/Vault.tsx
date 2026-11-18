import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import type { SecretRecord, VaultSettings } from '@gestor/shared/vault'
import { accountContext, decrypt, deriveKey, encrypt, randomBase64, verifierText } from './vault-crypto'
import './vault.css'

interface Account { id: number; login: string; name: string }
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || data === null) throw new Error(data?.error ?? 'No se pudo conectar. Vuelve a intentarlo.')
  return data as T
}
const message = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.'

export default function Vault() {
  const [settings, setSettings] = useState<VaultSettings | null | undefined>(undefined)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [phrase, setPhrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const epoch = useRef(0)
  const lock = useCallback(() => {
    epoch.current++
    setKey(null)
    setPhrase('')
    setConfirm('')
    setBusy(false)
    setError('')
  }, [])
  useEffect(() => {
    let current = true
    Promise.all([api<{ settings: VaultSettings | null }>('/vault'), api<{access_accounts: Account[]}>('/catalog')])
      .then(([meta, catalog]) => {
        if (current) { setSettings(meta.settings); setAccounts(catalog.access_accounts); setError('') }
      })
      .catch(e => { if (current) setError(message(e)) })
    return () => { current = false; epoch.current++ }
  }, [loadAttempt])
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) lock() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', lock)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', lock)
    }
  }, [lock])
  useEffect(() => {
    if (!key) return
    let timer: number
    const start = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lock, 300_000)
    }
    start()
    window.addEventListener('pointerdown', start)
    window.addEventListener('keydown', start)
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start) }
  }, [key, lock])

  async function unlock(event: FormEvent) {
    event.preventDefault()
    if (settings === undefined || busy) return
    if (!settings && phrase !== confirm) { setError('Las frases maestras deben coincidir.'); return }
    const attempt = ++epoch.current
    setBusy(true)
    setError('')
    try {
      const salt = settings?.salt ?? randomBase64(16)
      const candidate = await deriveKey(phrase, salt)
      if (attempt !== epoch.current) return
      if (settings) {
        let verified = false
        try { verified = await decrypt(candidate, settings, verifierText) === verifierText } catch { /* Authentication tag mismatch */ }
        if (!verified) throw new Error('No se pudo desbloquear con esa frase maestra.')
      } else {
        const config: VaultSettings = { salt, version: 1, ...await encrypt(candidate, verifierText, verifierText) }
        if (attempt !== epoch.current) return
        await api('/vault', 'POST', config)
        if (attempt !== epoch.current) { setLoadAttempt(n => n + 1); return }
        setSettings(config)
      }
      if (attempt === epoch.current) { setKey(candidate); setPhrase(''); setConfirm('') }
    } catch (e) {
      if (attempt === epoch.current) {
        setError(message(e))
        if (!settings) {
          try { const meta = await api<{settings: VaultSettings | null}>('/vault'); if (attempt === epoch.current && meta.settings) setSettings(meta.settings) } catch { /* Retry is available */ }
        }
      }
    } finally { if (attempt === epoch.current) setBusy(false) }
  }

  return <section className="vault-page">
    <header className="vault-heading"><div><h1>Bóveda de accesos</h1><p>Gestiona las contraseñas de tus cuentas de suscripción.</p></div>
      {key && <button className="vault-secondary" onClick={lock}><LockKeyhole size={16}/> Bloquear</button>}
    </header>
    {error && <p className="vault-error" role="alert">{error}</p>}
    {settings === undefined ? <div className="vault-card">{error ? <button className="vault-secondary" onClick={() => setLoadAttempt(n => n + 1)}>Reintentar</button> : <p role="status">Cargando bóveda…</p>}</div>
      : key ? <Accounts accounts={accounts} cryptoKey={key}/>
      : <div className="vault-card vault-locked">
        <div className="vault-emblem"><ShieldCheck size={32}/></div>
        <h2>{settings ? 'Desbloquear bóveda' : 'Crear tu bóveda'}</h2>
        <p>{settings ? 'Introduce tu frase maestra para consultar o modificar una contraseña.' : 'Elige una frase maestra de al menos 16 caracteres y guárdala en un lugar seguro. La necesitarás para recuperar tus contraseñas.'}</p>
        <form onSubmit={unlock}>
          <label>Frase maestra<input type="password" required minLength={settings ? 1 : 16} maxLength={512} value={phrase} onChange={e => setPhrase(e.target.value)} autoComplete={settings ? 'current-password' : 'new-password'}/></label>
          {!settings && <label>Confirmar frase maestra<input type="password" required minLength={16} maxLength={512} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/></label>}
          <button className="vault-primary" disabled={busy}><KeyRound size={16}/>{busy ? 'Verificando…' : settings ? 'Desbloquear' : 'Crear bóveda'}</button>
        </form>
      </div>}
  </section>
}

function Accounts({ accounts, cryptoKey }: { accounts: Account[]; cryptoKey: CryptoKey }) {
  const [id, setId] = useState(accounts[0]?.id ?? 0)
  return <div className="vault-card vault-accounts">
    <h2>Credenciales por cuenta</h2>
    {accounts.length ? <>
      <label>Cuenta de acceso<select value={id} onChange={e => setId(Number(e.target.value))}>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.login}</option>)}
      </select></label>
      <SecretEditor key={id} id={id} cryptoKey={cryptoKey}/>
    </> : <p>Primero <a href="#catalogo/cuentas">registra una cuenta en el catálogo</a> para guardar su contraseña.</p>}
  </div>
}

function SecretEditor({ id, cryptoKey }: { id: number; cryptoKey: CryptoKey }) {
  const [revision, setRevision] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [shown, setShown] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const active = useRef(false)
  useEffect(() => {
    let current = true
    active.current = true
    setRevision(null)
    setFeedback('')
    setError('')
    setText('')
    setShown(false)
    async function load() {
      const { secret } = await api<{secret: SecretRecord | null}>('/vault/accounts/' + id)
      const value = secret ? await decrypt(cryptoKey, secret, accountContext(id)) : ''
      if (current) { setText(value); setRevision(secret?.revision ?? 0) }
    }
    load().catch(() => { if (current) setError('No se pudo abrir la credencial. Vuelve a cargarla.') })
    return () => { current = false; active.current = false }
  }, [id, cryptoKey, refresh])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!text || saving || revision === null) return
    setSaving(true); setFeedback(''); setError('')
    try {
      const envelope = await encrypt(cryptoKey, text, accountContext(id))
      if (!active.current) return
      const result = await api<{ revision: number }>('/vault/accounts/' + id, 'PUT', { ...envelope, revision })
      if (active.current) { setRevision(result.revision); setShown(false); setFeedback('Contraseña guardada.') }
    } catch (e) { if (active.current) setError(message(e)) }
    finally { if (active.current) setSaving(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setFeedback('Contraseña copiada.'); setError('') }
    catch { setError('El navegador no permitió copiar. Puedes mostrar y seleccionar la contraseña.') }
  }
  return <form onSubmit={save}>
    {revision !== null && <>
      <label>Contraseña de la cuenta<input type={shown ? 'text' : 'password'} required maxLength={2048} autoComplete="off" spellCheck={false} value={text} onChange={e => { setText(e.target.value); setFeedback('') }}/></label>
      <div className="vault-actions">
        <button className="vault-primary" disabled={!text || saving}><Check size={16}/>{saving ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="vault-secondary" aria-pressed={shown} disabled={!text} onClick={() => setShown(!shown)}>{shown ? <EyeOff size={16}/> : <Eye size={16}/>}{shown ? 'Ocultar' : 'Mostrar'}</button>
        <button type="button" className="vault-secondary" disabled={!text} onClick={copy}><Copy size={16}/>Copiar</button>
      </div>
    </>}
    {revision === null && !error && <p role="status">Abriendo credencial…</p>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <div><p className="vault-error" role="alert">{error}</p><button type="button" className="vault-secondary" onClick={() => setRefresh(n => n + 1)}>Volver a cargar</button></div>}
  </form>
}
