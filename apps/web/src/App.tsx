import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownUp, ArrowRight, CalendarDays, CircleCheck, Layers3, LayoutGrid, Plus, ShieldCheck, X } from 'lucide-react'
import { financeDateSchema, type Charge, type Dashboard, type Expense, type Payment } from '@gestor/shared/finance'
import Catalog from './Catalog'
import Vault from './Vault'
import { Button } from './components/ui/button'
import { FinanceOperationDialog } from './FinanceOperationDialog'
import { CashChart, ChargeMargin, DataError, Metrics, MovementList, PendingPanel, RangeLabel } from './FinanceOverview'
import { displayDate, displayMonth, localDate, monthStart, movements, query, rangeFor, useApi, type DateRange, type FinanceCatalog, type MovementKind, type Operation, type Period } from './finance-model'

const pages = [
  { id: 'summary', href: '#resumen', label: 'Resumen', icon: LayoutGrid },
  { id: 'movements', href: '#movimientos', label: 'Movimientos', icon: ArrowDownUp },
  { id: 'catalog', href: '#catalogo', label: 'Catálogo', icon: Layers3 },
  { id: 'vault', href: '#boveda', label: 'Bóveda', icon: ShieldCheck },
] as const

const catalogPaths = {
  subscriptions: 'suscripciones',
  services: 'servicios',
  people: 'personas',
  accounts: 'cuentas',
  agreements: 'acuerdos',
} as const

type CatalogTab = keyof typeof catalogPaths
type Page = typeof pages[number]['id']
type Route = { page: Page; catalogTab?: CatalogTab; pending?: boolean }
type CurrentOperation = { mode: Operation | 'pick'; chargeId?: number }
type MovementTab = 'all' | MovementKind | 'pending'

const periods: { value: Period; label: string }[] = [
  { value: 'month', label: 'Este mes' },
  { value: 'previous', label: 'Mes anterior' },
  { value: 'six', label: 'Últimos 6 meses' },
  { value: 'year', label: 'Este año' },
  { value: 'custom', label: 'Personalizado' },
]

const movementTabs: { value: MovementTab; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'payment', label: 'Ingresos' },
  { value: 'expense', label: 'Gastos' },
  { value: 'charge', label: 'Cargos' },
  { value: 'pending', label: 'Pendientes' },
]

function currentRoute(): Route {
  const [path, subpath] = window.location.hash.split('/')
  const page = pages.find((item) => item.href === path)?.id ?? 'summary'
  if (page === 'catalog') {
    const catalogTab = (Object.keys(catalogPaths) as CatalogTab[]).find((tab) => catalogPaths[tab] === subpath)
    return { page, catalogTab }
  }
  return { page, pending: page === 'movements' && subpath === 'pendientes' }
}

function Brand() {
  return (
    <a className="brand" href="#resumen" aria-label="Suscripciones, ir al resumen">
      <span className="brand-icon" aria-hidden="true"><Layers3 size={23} strokeWidth={2} /></span>
      <span className="brand-text"><strong>Suscripciones</strong><small>Gestión personal</small></span>
    </a>
  )
}

function Navigation({ page, mobile }: { page: Page; mobile?: boolean }) {
  return (
    <nav className={mobile ? 'mobile-nav' : 'side-nav'} aria-label={mobile ? 'Navegación móvil' : 'Navegación principal'}>
      {pages.map(({ id, href, label, icon: Icon }) => (
        <a key={id} href={href} aria-current={id === page ? 'page' : undefined}>
          <Icon size={19} strokeWidth={1.85} aria-hidden="true" /><span>{label}</span>
        </a>
      ))}
    </nav>
  )
}

export default function App() {
  const [route, setRoute] = useState(currentRoute)
  const [operation, setOperation] = useState<CurrentOperation | null>(null)
  const [financeRevision, setFinanceRevision] = useState(0)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const main = useRef<HTMLElement>(null)
  const inFinance = route.page === 'summary' || route.page === 'movements'
  const catalog = useApi<FinanceCatalog>(inFinance ? '/catalog' : null, catalogRevision)
  const pageLabel = pages.find(({ id }) => id === route.page)?.label

  useEffect(() => {
    function updateRoute() {
      setRoute(currentRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  }, [])

  useEffect(() => { document.title = `${pageLabel} · Suscripciones` }, [pageLabel])

  const refreshFinance = () => setFinanceRevision((revision) => revision + 1)
  const refreshCatalog = () => setCatalogRevision((revision) => revision + 1)
  const record = () => setOperation({ mode: 'pick' })
  const setup = (tab: CatalogTab) => {
    setOperation(null)
    window.location.hash = `catalogo/${catalogPaths[tab]}`
  }

  let content: ReactNode
  if (route.page === 'catalog') {
    content = <Catalog key={route.catalogTab ?? 'catalog'} initialTab={route.catalogTab} onChange={refreshCatalog} />
  } else if (route.page === 'vault') {
    content = <Vault />
  } else {
    content = <FinanceWorkspace
      route={route}
      revision={financeRevision}
      catalog={catalog.data}
      catalogError={catalog.error}
      notice={notice}
      onDismiss={() => setNotice('')}
      onRefresh={refreshFinance}
      onRefreshCatalog={refreshCatalog}
      onRecord={record}
      onConfigure={() => setup('subscriptions')}
      onPay={(id) => setOperation({ mode: 'payment', chargeId: id })}
    />
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); main.current?.focus() }}>Saltar al contenido</a>
      <aside className="sidebar">
        <Brand />
        <Navigation page={route.page} />
        <div className="sidebar-footer"><span className="sidebar-currency" aria-hidden="true">Bs</span><span><strong>Bolivianos</strong><small>Moneda de registro</small></span></div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="mobile-brand"><Brand /></div>
            <p className="topbar-section">{pageLabel}</p>
            <div className="topbar-date"><CalendarDays size={16} aria-hidden="true" /><time dateTime={localDate()}>{displayDate(localDate())}</time></div>
            {inFinance && <Button className="mobile-record" size="sm" onClick={record}><Plus size={18} aria-hidden="true" />Registrar</Button>}
          </div>
        </header>
        <main id="main-content" className="app-content" ref={main} tabIndex={-1}>{content}</main>
      </div>
      <Navigation page={route.page} mobile />
      <FinanceOperationDialog
        operation={operation?.mode ?? null}
        initialChargeId={operation?.chargeId}
        catalog={catalog.data}
        catalogError={catalog.error}
        onChoose={(mode) => setOperation({ mode })}
        onClose={() => setOperation(null)}
        onSetup={setup}
        onRetryCatalog={refreshCatalog}
        onSuccess={(message) => {
          setNotice(message)
          setOperation(null)
          refreshFinance()
        }}
      />
    </div>
  )
}

type FinanceWorkspaceProps = {
  route: Route
  revision: number
  catalog?: FinanceCatalog
  catalogError?: string
  notice: string
  onDismiss: () => void
  onRefresh: () => void
  onRefreshCatalog: () => void
  onRecord: () => void
  onConfigure: () => void
  onPay: (id: number) => void
}

function FinanceWorkspace({ route, revision, catalog, catalogError, notice, onDismiss, onRefresh, onRefreshCatalog, onRecord, onConfigure, onPay }: FinanceWorkspaceProps) {
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState<DateRange>(rangeFor('month'))
  const [service, setService] = useState('')
  const [person, setPerson] = useState('')
  const [movementTab, setMovementTab] = useState<Exclude<MovementTab, 'pending'>>('all')
  const isDashboard = route.page === 'summary'
  const activeTab = route.pending ? 'pending' : movementTab
  const range = period === 'custom' ? custom : rangeFor(period)
  const ready = range.from <= range.to && financeDateSchema.safeParse(range.from).success && financeDateSchema.safeParse(range.to).success
  const filters = { ...range, service, person }
  const suffix = query(filters)
  const showTrend = ready && (period === 'month' || period === 'previous')
  const trendRange = showTrend ? { from: monthStart(range.to, -5), to: range.to } : range
  const summary = useApi<Dashboard>(isDashboard && ready ? `/dashboard${suffix}` : null, revision)
  const trend = useApi<Dashboard>(isDashboard && showTrend ? `/dashboard${query({ ...filters, ...trendRange })}` : null, revision)
  const pending = useApi<Charge[]>(ready && (isDashboard || activeTab === 'pending') ? `/charges${query(filters, true)}` : null, revision)
  const expenses = useApi<Expense[]>(ready && !person && (isDashboard || activeTab === 'all' || activeTab === 'expense') ? `/expenses${suffix}` : null, revision)
  const charges = useApi<Charge[]>(ready && (isDashboard || activeTab === 'all' || activeTab === 'charge') ? `/charges${suffix}` : null, revision)
  const payments = useApi<Payment[]>(ready && (isDashboard || activeTab === 'all' || activeTab === 'payment') ? `/payments${suffix}` : null, revision)
  const entryStates = !isDashboard && activeTab === 'pending' ? [pending] : [expenses, charges, payments]
  const chart = showTrend ? trend : summary
  const entries = !isDashboard && activeTab === 'pending' ? movements([], pending.data ?? [], []) : movements(expenses.data ?? [], charges.data ?? [], payments.data ?? [])
  const activeServices = new Set(catalog?.services.filter((item) => item.active).map((item) => item.id))
  const configured = catalog?.subscriptions.some((item) => item.active && activeServices.has(item.service_id))

  function selectMovementTab(tab: MovementTab) {
    if (tab === 'pending') window.location.hash = 'movimientos/pendientes'
    else {
      setMovementTab(tab)
      if (route.pending) window.location.hash = 'movimientos'
    }
  }

  return (
    <div className="finance-workspace">
      <header className="page-heading">
        <div>
          <p className="heading-period"><CalendarDays size={15} aria-hidden="true" />{ready && range.from.slice(0, 7) === range.to.slice(0, 7) ? displayMonth(range.to) : 'Finanzas'}</p>
          <h1>{isDashboard ? 'Resumen financiero' : 'Movimientos'}</h1>
          <p className="page-description">{isDashboard ? 'Gastos, ingresos y saldos de tus suscripciones.' : 'Consulta el historial de gastos, cargos y pagos.'}</p>
        </div>
        <Button className="desktop-record" onClick={onRecord}><Plus size={19} strokeWidth={2.25} aria-hidden="true" />Registrar movimiento</Button>
      </header>

      {notice && <div className="success-notice"><p role="status"><CircleCheck size={18} aria-hidden="true" />{notice}</p><Button variant="ghost" size="icon" aria-label="Descartar confirmación" onClick={onDismiss}><X size={17} aria-hidden="true" /></Button></div>}

      <div className="filter-bar" role="group" aria-label="Filtros financieros">
        <label className="filter-period"><span>Periodo</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Servicio</span><select value={service} onChange={(event) => setService(event.target.value)} disabled={!catalog}><option value="">Todos</option>{catalog?.services.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactivo)'}</option>)}</select></label>
        <label><span>Persona</span><select value={person} onChange={(event) => setPerson(event.target.value)} disabled={!catalog}><option value="">Todas</option>{catalog?.people.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inactiva)'}</option>)}</select></label>
        {(period !== 'month' || service || person) ? <Button className="filter-reset" variant="ghost" size="sm" onClick={() => { setPeriod('month'); setService(''); setPerson('') }}>Restablecer</Button> : ready && <p className="filter-range"><RangeLabel {...range} /></p>}
        {period === 'custom' && <div className="custom-dates">
          <label><span>Desde</span><input type="date" min="0001-01-01" max="9999-12-31" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
          <label><span>Hasta</span><input type="date" min="0001-01-01" max="9999-12-31" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
        </div>}
      </div>

      {catalogError && <DataError message={`No se pudieron cargar los filtros de catálogo. ${catalogError}`} onRetry={onRefreshCatalog} />}

      {!ready ? <p className="form-error" role="alert">Selecciona un intervalo de fechas válido.</p> : isDashboard ? (
        <>
          {summary.error && <DataError message={summary.error} onRetry={onRefresh} />}
          <Metrics dashboard={summary.data} loading={summary.loading} personFiltered={Boolean(person)} />
          {!person && <ChargeMargin dashboard={summary.data} loading={summary.loading} />}
          <div className="dashboard-grid">
            <CashChart range={trendRange} data={chart.data} loading={chart.loading} error={chart.error} onRetry={onRefresh} trailing={showTrend} incomeOnly={Boolean(person)} />
            <PendingPanel data={pending.data} loading={pending.loading} error={pending.error} onRetry={onRefresh} onView={() => selectMovementTab('pending')} date={range.to} />
          </div>
          <section className="panel movements-panel" aria-labelledby="movements-heading">
            <div className="panel-header">
              <div><h2 id="movements-heading">Movimientos recientes</h2><p>Del periodo seleccionado</p></div>
              <a className="text-link" href="#movimientos" onClick={() => setMovementTab('all')}><span>Ver historial</span><ArrowRight size={17} aria-hidden="true" /></a>
            </div>
            <MovementList entries={entries.slice(0, 5)} loading={entryStates.some((item) => item.loading)} error={entryStates.find((item) => item.error)?.error} onRetry={onRefresh} onRecord={onRecord} onConfigure={onConfigure} configured={configured} />
          </section>
        </>
      ) : (
        <section className="panel movements-panel" aria-labelledby="history-heading">
          <div className="panel-header history-header"><div><h2 id="history-heading">{activeTab === 'pending' ? 'Cargos pendientes' : 'Historial de movimientos'}</h2><p>{activeTab === 'pending' ? `Al ${displayDate(range.to)}` : <RangeLabel {...range} />}</p></div></div>
          <div className="movement-tabs" role="group" aria-label="Tipo de movimiento">{movementTabs.map((item) => <button key={item.value} type="button" aria-pressed={activeTab === item.value} onClick={() => selectMovementTab(item.value)}>{item.label}</button>)}</div>
          {activeTab === 'expense' && person ? <p className="section-loading">Para consultar los gastos compartidos por suscripción, elige «Todas» en Persona.</p> : (
            <MovementList entries={entries} loading={entryStates.some((item) => item.loading)} error={entryStates.find((item) => item.error)?.error} onRetry={onRefresh} onRecord={onRecord} onConfigure={onConfigure} configured={configured} pendingOnly={activeTab === 'pending'} onPay={activeTab === 'pending' ? onPay : undefined} />
          )}
        </section>
      )}
    </div>
  )
}
