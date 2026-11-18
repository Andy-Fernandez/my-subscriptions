import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, ChartNoAxesColumn, Clock3, HandCoins, Plus, ReceiptText, Scale, Wallet, type LucideIcon } from 'lucide-react'
import type { Charge, Dashboard, MonthlyCash } from '@gestor/shared/finance'
import { Button } from './components/ui/button'
import { displayDate, displayMonth, localDate, money, type DateRange, type Movement } from './finance-model'
import { operationInfo } from './FinanceOperationDialog'

export function RangeLabel({ from, to }: DateRange) {
  return <>{displayDate(from)} <span aria-hidden="true">→</span><span className="sr-only"> a </span> {displayDate(to)}</>
}

export function Metrics({ dashboard, loading, personFiltered }: { dashboard?: Dashboard; loading: boolean; personFiltered: boolean }) {
  const cards: { label: string; caption: string; value?: number; icon: LucideIcon; tone: string }[] = [
    { label: 'Resultado de caja', caption: 'Ingresos menos gastos', value: dashboard?.net_cents, icon: Activity, tone: 'net' },
    { label: 'Ingresos', caption: 'Pagos recibidos', value: dashboard?.income_cents, icon: ArrowDownLeft, tone: 'income' },
    { label: 'Gastos', caption: 'Suscripciones pagadas', value: dashboard?.expenses_cents, icon: ArrowUpRight, tone: 'expense' },
    { label: 'Por cobrar', caption: 'Saldo acumulado al corte', value: dashboard?.pending_cents, icon: Clock3, tone: 'pending' },
  ]
  const visibleCards = personFiltered ? cards.filter(({ tone }) => tone === 'income' || tone === 'pending') : cards

  return (
    <dl className={`metrics-grid${personFiltered ? ' metrics-person' : ''}`} aria-label="Indicadores financieros" aria-busy={loading}>
      {visibleCards.map(({ label, caption, value, icon: Icon, tone }) => (
        <div className={`metric metric-${tone}`} key={tone}>
          <dt><span className="metric-icon" aria-hidden="true"><Icon size={17} strokeWidth={1.9} /></span>{label}</dt>
          <dd className={`metric-value${loading ? ' is-loading' : ''}`}>{value === undefined ? '—' : money(value)}</dd>
          <dd className="metric-caption">{caption}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ChargeMargin({ dashboard, loading }: { dashboard?: Dashboard; loading: boolean }) {
  const margin = dashboard?.charge_margin_cents
  return (
    <section className="charge-margin" aria-labelledby="margin-heading" aria-busy={loading}>
      <span className="panel-icon" aria-hidden="true"><Scale size={17} /></span>
      <div>
        <h2 id="margin-heading">Margen sobre cargos</h2>
        <p>Cargos emitidos menos gastos del periodo</p>
      </div>
      <div className="charge-margin-value">
        <strong className={margin === undefined ? undefined : margin < 0 ? 'margin-negative' : margin > 0 ? 'margin-positive' : undefined}>{margin === undefined ? '—' : money(margin)}</strong>
        {dashboard && <small>{money(dashboard.charged_cents)} en cargos</small>}
      </div>
    </section>
  )
}

type SeriesItem = { label: string; name: string; income: number; expense: number }

function cashSeries(range: DateRange, monthly: MonthlyCash[]): SeriesItem[] {
  const firstYear = Number(range.from.slice(0, 4))
  const lastYear = Number(range.to.slice(0, 4))
  const firstMonth = firstYear * 12 + Number(range.from.slice(5, 7)) - 1
  const lastMonth = lastYear * 12 + Number(range.to.slice(5, 7)) - 1
  const monthCount = lastMonth - firstMonth + 1
  const values = new Map(monthly.map((item) => [item.month, item]))
  if (monthCount <= 12) {
    return Array.from({ length: monthCount }, (_, index) => {
      const monthIndex = firstMonth + index
      const month = `${String(Math.floor(monthIndex / 12)).padStart(4, '0')}-${String(monthIndex % 12 + 1).padStart(2, '0')}`
      return { label: displayMonth(month, true), name: displayMonth(month), income: values.get(month)?.income_cents ?? 0, expense: values.get(month)?.expenses_cents ?? 0 }
    })
  }

  const width = Math.ceil((lastYear - firstYear + 1) / 12)
  const periods = Array.from({ length: Math.ceil((lastYear - firstYear + 1) / width) }, (_, index) => {
    const start = firstYear + index * width
    const end = Math.min(start + width - 1, lastYear)
    const label = start === end ? String(start) : `${start}–${end}`
    return { label, name: label, income: 0, expense: 0 }
  })
  for (const item of monthly) {
    const period = periods[Math.floor((Number(item.month.slice(0, 4)) - firstYear) / width)]
    if (period) {
      period.income += item.income_cents
      period.expense += item.expenses_cents
    }
  }
  return periods
}

function compactMoney(cents: number) {
  return new Intl.NumberFormat('es-BO', { notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100)
}

export function CashChart({ range, data, loading, error, onRetry, trailing, incomeOnly }: { range: DateRange; data?: Dashboard; loading: boolean; error?: string; onRetry: () => void; trailing: boolean; incomeOnly: boolean }) {
  const series = data ? cashSeries(range, data.monthly) : []
  const hasActivity = series.some(({ income, expense }) => income > 0 || expense > 0)
  const peak = Math.max(100, ...series.flatMap(({ income, expense }) => [income, expense]))
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  const max = Math.ceil(peak / magnitude) * magnitude
  const labels = hasActivity ? [max, max * .75, max * .5, max * .25, 0].map(compactMoney) : ['', '', '', '', '0']

  return (
    <section className="panel cash-panel" aria-labelledby="chart-heading">
      <div className="panel-header">
        <div>
          <h2 id="chart-heading">Flujo de caja</h2>
          <p>{trailing ? 'Últimos 6 meses al corte' : <RangeLabel {...range} />}</p>
        </div>
        <span className="panel-icon" aria-hidden="true"><ChartNoAxesColumn size={18} /></span>
      </div>
      <div className="chart-legend"><span><i className="income-mark" />Ingresos</span>{!incomeOnly && <span><i className="expense-mark" />Gastos</span>}</div>
      {error ? <DataError message={error} onRetry={onRetry} /> : (
        <>
          <figure className="chart-frame" aria-label={loading ? 'Cargando gráfico' : hasActivity ? `Gráfico de ${incomeOnly ? 'ingresos' : 'ingresos y gastos'}. Los valores están disponibles en la tabla.` : 'Sin movimientos de caja en el periodo'} aria-busy={loading}>
            <div className="chart-axis" aria-hidden="true"><span className="chart-currency">Bs</span>{labels.map((label, index) => <span key={index}>{label}</span>)}</div>
            <div className="chart-body" aria-hidden="true">
              <div className="chart-gridlines" />
              <div className="chart-columns">
                {series.map(({ label, name, income, expense }) => (
                  <div className="chart-column" key={name}>
                    <div className="chart-bars" title={`${name}: ${money(income)} en ingresos${incomeOnly ? '' : ` · ${money(expense)} en gastos`}`}>
                      {income > 0 && <i className="chart-bar bar-income" style={{ height: `${income / max * 100}%` }} />}
                      {!incomeOnly && expense > 0 && <i className="chart-bar bar-expense" style={{ height: `${expense / max * 100}%` }} />}
                    </div>
                    <span className="chart-date">{label}</span>
                  </div>
                ))}
              </div>
              {(!hasActivity || loading) && <span className="chart-empty">{loading ? 'Cargando datos…' : 'Sin movimientos de caja'}</span>}
            </div>
          </figure>
          {hasActivity && <details className="chart-details">
            <summary>Ver valores del gráfico</summary>
            <table>
              <thead><tr><th scope="col">Periodo</th><th scope="col">Ingresos</th>{!incomeOnly && <th scope="col">Gastos</th>}</tr></thead>
              <tbody>{series.map(({ name, income, expense }) => <tr key={name}><th scope="row">{name}</th><td>{money(income)}</td>{!incomeOnly && <td>{money(expense)}</td>}</tr>)}</tbody>
            </table>
          </details>}
        </>
      )}
    </section>
  )
}

export function PendingPanel({ data, loading, error, onRetry, onView, date }: { data?: Charge[]; loading: boolean; error?: string; onRetry: () => void; onView: () => void; date: string }) {
  const balances = new Map<number, { name: string; amount: number; count: number }>()
  for (const { person_id, person_name, pending_cents } of data ?? []) {
    const existing = balances.get(person_id)
    balances.set(person_id, { name: person_name, amount: (existing?.amount ?? 0) + pending_cents, count: (existing?.count ?? 0) + 1 })
  }
  const people = [...balances.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))

  return (
    <section className="panel pending-panel" aria-labelledby="pending-heading">
      <div className="panel-header">
        <div><h2 id="pending-heading">Saldos por cobrar</h2><p>Al {displayDate(date)}</p></div>
        <span className="panel-icon" aria-hidden="true"><HandCoins size={18} /></span>
      </div>
      {error ? <DataError message={error} onRetry={onRetry} /> : loading ? <p className="section-loading" role="status">Cargando saldos…</p> : people.length ? (
        <div className="pending-contents">
          <ul className="pending-list">
            {people.slice(0, 4).map(({ name, amount, count }, index) => (
              <li key={index}>
                <span aria-hidden="true" className="pending-avatar">{name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()}</span>
                <span className="pending-person"><strong>{name}</strong><small>{count} {count === 1 ? 'cargo pendiente' : 'cargos pendientes'}</small></span>
                <strong className="pending-amount">{money(amount)}</strong>
              </li>
            ))}
          </ul>
          <Button className="panel-link" variant="ghost" onClick={onView}>Ver cargos pendientes <ArrowRight size={16} aria-hidden="true" /></Button>
        </div>
      ) : (
        <div className="pending-empty">
          <span className="empty-symbol" aria-hidden="true"><Wallet size={23} strokeWidth={1.65} /></span>
          <strong>Sin saldos pendientes</strong>
          <p>Los cargos por cobrar aparecerán aquí.</p>
        </div>
      )}
    </section>
  )
}

export function DataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="data-error"><p role="alert">{message}</p><Button size="sm" variant="outline" onClick={onRetry}>Reintentar</Button></div>
}

export function MovementList({ entries, loading, error, onRetry, onRecord, onConfigure, onPay, configured, pendingOnly }: { entries: Movement[]; loading: boolean; error?: string; onRetry: () => void; onRecord: () => void; onConfigure: () => void; onPay?: (id: number) => void; configured?: boolean; pendingOnly?: boolean }) {
  if (error) return <DataError message={error} onRetry={onRetry} />
  if (loading) return <p className="section-loading" role="status">Cargando movimientos…</p>
  if (!entries.length) return (
    <div className="movements-empty">
      <span className="empty-symbol" aria-hidden="true"><ReceiptText size={23} strokeWidth={1.65} /></span>
      <div>
        <strong>{pendingOnly ? 'Sin cargos pendientes al corte' : 'Sin movimientos para estos filtros'}</strong>
        {!pendingOnly && configured === false && <p>Agrega una suscripción para registrar tu primer movimiento.</p>}
      </div>
      {!pendingOnly && <Button variant="outline" onClick={configured === false ? onConfigure : onRecord}>{configured === false ? 'Ir a Suscripciones' : 'Registrar movimiento'} {configured === false ? <ArrowRight size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}</Button>}
    </div>
  )

  const today = localDate()
  return (
    <ul className="movements-list" aria-label="Historial de movimientos">
      {entries.map((entry) => {
        const { icon: Icon, label } = operationInfo[entry.kind]
        const sign = entry.kind === 'payment' ? '+' : entry.kind === 'expense' ? '−' : ''
        return (
          <li className="movement-row" key={`${entry.kind}-${entry.id}`}>
            <span className={`movement-icon kind-${entry.kind}`} aria-hidden="true"><Icon size={18} /></span>
            <div className="movement-info"><strong>{entry.title}</strong>{entry.detail && <span>{entry.detail}</span>}{entry.due && <small>Vence el <time dateTime={entry.due}>{displayDate(entry.due)}</time></small>}{entry.note && <small>{entry.note}</small>}</div>
            <span className="movement-kind"><i />{label}</span>
            <time className="movement-date" dateTime={entry.date}>{displayDate(entry.date)}</time>
            <div className={`movement-amount amount-${entry.kind}`}>
              <strong>{sign}{money(entry.amount)}</strong>
              {entry.pending !== undefined && <small>{entry.pending > 0 ? `${money(entry.pending)} pendiente` : 'Pagado'}</small>}
            </div>
            {onPay && entry.date <= today && <Button variant="outline" size="sm" className="movement-pay" onClick={() => onPay(entry.id)}>Registrar pago</Button>}
          </li>
        )
      })}
    </ul>
  )
}
