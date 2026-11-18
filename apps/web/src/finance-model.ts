import { useEffect, useState } from 'react'
import type { CatalogData } from '@gestor/shared/catalog'
import type { Charge, Expense, Payment } from '@gestor/shared/finance'

export type FinanceCatalog = Pick<CatalogData, 'people' | 'services' | 'subscriptions' | 'agreements'>

export type Operation = 'expense' | 'charge' | 'payment' | 'agreement'
export type MovementKind = Exclude<Operation, 'agreement'>
export type DateRange = { from: string; to: string }
export type Period = 'month' | 'previous' | 'six' | 'year' | 'custom'
export type FinanceFilters = DateRange & { service: string; person: string }
export type Movement = {
  id: number
  kind: MovementKind
  date: string
  amount: number
  title: string
  detail: string
  note: string | null
  pending?: number
  due?: string | null
}

const wholeCurrency = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 })
const decimalSeparator = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 1 }).formatToParts(0).find((part) => part.type === 'decimal')?.value ?? ','
const fullDate = new Intl.DateTimeFormat('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fullMonth = new Intl.DateTimeFormat('es-BO', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const shortMonth = new Intl.DateTimeFormat('es-BO', { month: 'short', timeZone: 'UTC' })

export function money(cents: number) {
  const absolute = BigInt(Math.abs(cents))
  const whole = wholeCurrency.format(absolute / 100n)
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${cents < 0 ? '−' : ''}Bs ${whole}${decimalSeparator}${fraction}`
}

export function displayDate(value: string) {
  return fullDate.format(new Date(`${value}T00:00:00Z`))
}

export function displayMonth(value: string, short = false) {
  const name = (short ? shortMonth : fullMonth).format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`))
  return name[0].toUpperCase() + name.slice(1).replace(/\.$/, '')
}

export function localDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function monthStart(date: string, offset = 0) {
  const month = new Date(`${date.slice(0, 7)}-01T00:00:00Z`)
  month.setUTCMonth(month.getUTCMonth() + offset)
  return month.getUTCFullYear() < 1 ? '0001-01-01' : month.toISOString().slice(0, 10)
}

export function rangeFor(period: Exclude<Period, 'custom'>): DateRange {
  const today = localDate()
  if (period === 'previous') {
    const end = new Date(`${monthStart(today)}T00:00:00Z`)
    end.setUTCDate(0)
    return { from: monthStart(today, -1), to: end.toISOString().slice(0, 10) }
  }
  if (period === 'six') return { from: monthStart(today, -5), to: today }
  if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  return { from: monthStart(today), to: today }
}

export function toCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined
  const [whole, fraction = ''] = normalized.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined
}

export function query(filters: FinanceFilters, pending = false) {
  const params = new URLSearchParams({ to: filters.to })
  if (pending) params.set('pending', '1')
  else params.set('from', filters.from)
  if (filters.service) params.set('service_id', filters.service)
  if (filters.person) params.set('person_id', filters.person)
  return `?${params}`
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  headers.set('Accept', 'application/json')
  const response = await fetch(`/api${path}`, { ...options, headers, cache: 'no-store' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'No se pudo completar la solicitud.')
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('La sesión requiere acceso. Recarga la página e inicia sesión si se solicita.')
  }
  return response.json() as Promise<T>
}

type ApiResult<T> = { path: string | null; revision: number; data?: T; error?: string }

export function useApi<T>(path: string | null, revision: number) {
  const [result, setResult] = useState<ApiResult<T>>({ path: null, revision: -1 })

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    api<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ path, revision, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ path, revision, error: error instanceof Error ? error.message : 'No se pudo contactar con el servidor.' })
      },
    )
    return () => controller.abort()
  }, [path, revision])

  if (!path || result.path !== path || result.revision !== revision) return { loading: Boolean(path), data: undefined, error: undefined }
  return { loading: false, data: result.data, error: result.error }
}

export function movements(expenses: Expense[], charges: Charge[], payments: Payment[]): Movement[] {
  const subscriptionLabel = ({ service_name, subscription_name }: Expense | Charge | Payment) => (
    service_name === subscription_name ? service_name : `${service_name} · ${subscription_name}`
  )

  const entries: Movement[] = [
    ...expenses.map<Movement>((expense) => ({ id: expense.id, kind: 'expense', date: expense.paid_on, amount: expense.amount_cents, title: expense.subscription_name, detail: expense.service_name === expense.subscription_name ? '' : expense.service_name, note: expense.note })),
    ...charges.map<Movement>((charge) => ({ id: charge.id, kind: 'charge', date: charge.issued_on, amount: charge.amount_cents, title: charge.person_name, detail: subscriptionLabel(charge), note: charge.note, pending: charge.pending_cents, due: charge.due_on })),
    ...payments.map<Movement>((payment) => ({ id: payment.id, kind: 'payment', date: payment.received_on, amount: payment.amount_cents, title: payment.person_name, detail: subscriptionLabel(payment), note: payment.note })),
  ]
  return entries.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
}
