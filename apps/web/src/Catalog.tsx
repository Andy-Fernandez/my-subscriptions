import { useEffect, useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Archive,
  ArrowRightLeft,
  AtSign,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Store,
  UserMinus,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { Agreement, CatalogData, Membership, Subscription } from '@gestor/shared/catalog'
import { Button } from './components/ui/button'
import { CatalogForm, subscriptionAvailable, subscriptionLabel, type CatalogEditor } from './CatalogForm'
import { api, displayDate, localDate, money } from './finance-model'
import './catalog.css'

const tabs = {
  subscriptions: { label: 'Suscripciones', icon: Layers, add: 'Nueva suscripción', empty: 'Aún no hay suscripciones.', editor: { kind: 'subscription' } },
  services: { label: 'Servicios', icon: Store, add: 'Nuevo servicio', empty: 'Aún no hay servicios.', editor: { kind: 'service' } },
  people: { label: 'Personas', icon: UsersRound, add: 'Nueva persona', empty: 'Aún no hay personas.', editor: { kind: 'person' } },
  accounts: { label: 'Cuentas', icon: AtSign, add: 'Nueva cuenta', empty: 'Aún no hay cuentas de acceso.', editor: { kind: 'account' } },
  agreements: { label: 'Acuerdos', icon: ClipboardList, add: 'Nuevo acuerdo', empty: 'Aún no hay acuerdos.', editor: { kind: 'agreement' } },
} satisfies Record<string, { label: string; icon: LucideIcon; add: string; empty: string; editor: CatalogEditor }>

export type CatalogTab = keyof typeof tabs

type Dated = { start_date: string; end_date: string | null }
type OpenEditor = (value: CatalogEditor) => void
type CatalogProps = { initialTab?: CatalogTab; onChange?: () => void }

function periodStatus(item: Dated, today: string) {
  if (item.end_date !== null && (item.end_date <= today || item.end_date === item.start_date)) return 'Histórico'
  if (item.start_date > today) return 'Programado'
  return 'Vigente'
}

function dateRange(item: Dated) {
  const start = `Desde ${displayDate(item.start_date)}`
  return item.end_date ? `${start} · Finaliza el ${displayDate(item.end_date)}` : start
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

function Pill({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={active ? 'catalog-pill is-active' : 'catalog-pill'}>{label}</span>
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button variant="outline" size="icon" onClick={onClick} aria-label={`Editar ${name}`} title={`Editar ${name}`}>
      <Pencil size={16} aria-hidden="true" />
    </Button>
  )
}

function StateButton({ editor, open }: { editor: Extract<CatalogEditor, { kind: 'state' }>; open: OpenEditor }) {
  const { active, name } = editor.item
  const label = `${active ? 'Desactivar' : 'Reactivar'} ${name}`
  const Icon = active ? Archive : RotateCcw
  return <Button variant="ghost" size="icon" onClick={() => open(editor)} aria-label={label} title={label}><Icon size={17} aria-hidden="true" /></Button>
}

function RecordCard({ icon: Icon, name, detail, notes, badge, actions, children }: {
  icon: LucideIcon
  name: string
  detail?: string
  notes?: string
  badge: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <article className="catalog-record">
      <div className="catalog-record-main">
        <span className="catalog-record-icon"><Icon size={20} aria-hidden="true" /></span>
        <div className="catalog-record-label">
          <h3>{name}</h3>
          {detail && <p>{detail}</p>}
        </div>
        <div className="catalog-record-badge">{badge}</div>
        {actions && <div className="catalog-record-actions">{actions}</div>}
      </div>
      {notes && <p className="catalog-record-notes">{notes}</p>}
      {children}
    </article>
  )
}

function RecordDetails({ label, children }: { label: string; children: ReactNode }) {
  return <details className="catalog-details">
    <summary><span>{label}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="catalog-detail-content">{children}</div>
  </details>
}

function HistoryRow({ label, period, status, actions }: {
  label: string
  period: Dated
  status: string
  actions?: ReactNode
}) {
  return <li className="catalog-history-row">
    <div><strong>{label}</strong><small>{dateRange(period)}</small></div>
    <Pill label={status} active={status === 'Vigente'} />
    {actions && <div className="catalog-history-actions">{actions}</div>}
  </li>
}

function MembershipActions({ item, person, anotherSubscription, open }: {
  item: Membership; person: string; anotherSubscription: boolean; open: OpenEditor
}) {
  return <>
    {anotherSubscription && (
      <Button variant="ghost" size="icon" onClick={() => open({ kind: 'move', membership: item })} aria-label={`Trasladar a ${person}`} title={`Trasladar a ${person}`}>
        <ArrowRightLeft size={17} aria-hidden="true" />
      </Button>
    )}
    <Button variant="ghost" size="icon" onClick={() => open({ kind: 'membership-end', membership: item })} aria-label={`Retirar a ${person}`} title={`Retirar a ${person}`}>
      <UserMinus size={17} aria-hidden="true" />
    </Button>
  </>
}

function SubscriptionCard({ item, data, today, open }: {
  item: Subscription; data: CatalogData; today: string; open: OpenEditor
}) {
  const service = data.services.find((record) => record.id === item.service_id)
  const account = data.access_accounts.find((record) => record.id === item.access_account_id)
  const costs = data.service_cost_history.filter((record) => record.subscription_id === item.id)
  const memberships = data.memberships.filter((record) => record.subscription_id === item.id)
  const cost = costs.find((record) => periodStatus(record, today) === 'Vigente')
  const participants = memberships.filter((record) => periodStatus(record, today) === 'Vigente').length
  const available = subscriptionAvailable(item, data)
  const anotherSubscription = data.subscriptions.some((record) => record.id !== item.id && subscriptionAvailable(record, data))
  const hasActivePeople = data.people.some((person) => person.active)
  const state = item.active ? (available ? 'Activa' : 'Servicio inactivo') : 'Inactiva'
  const detail = [service?.name, account && (account.active ? account.name : `${account.name} (inactiva)`)].filter(Boolean).join(' · ')
  return <RecordCard
    icon={Layers}
    name={item.name}
    detail={detail}
    notes={item.notes}
    badge={<Pill label={state} active={available} />}
    actions={<>
      <EditButton name={item.name} onClick={() => open({ kind: 'subscription', item })} />
      <StateButton open={open} editor={{ kind: 'state', path: 'subscriptions', item }} />
    </>}
  >
    <div className="catalog-subscription-stats">
      <span><UsersRound size={15} aria-hidden="true" /> {participants} {participants === 1 ? 'integrante' : 'integrantes'}</span>
      <span><CircleDollarSign size={15} aria-hidden="true" /> {cost ? money(cost.amount_cents) : 'Sin costo vigente'}</span>
    </div>
    <RecordDetails label="Integrantes e historial">
      {memberships.length ? (
        <ul className="catalog-history">
          {memberships.map((membership) => {
            const person = data.people.find((record) => record.id === membership.person_id)
            const name = person?.name ?? 'Persona'
            const status = periodStatus(membership, today)
            return <HistoryRow
              key={membership.id}
              label={name}
              period={membership}
              status={status}
              actions={status !== 'Histórico' && <MembershipActions item={membership} person={name} anotherSubscription={anotherSubscription && Boolean(person?.active)} open={open} />}
            />
          })}
        </ul>
      ) : <p className="catalog-detail-empty">Todavía no hay asignaciones.</p>}
      {available && (
        <Button variant="outline" size="sm" disabled={!hasActivePeople} onClick={() => open({ kind: 'membership', subscriptionId: item.id })}>
          <UserPlus size={16} aria-hidden="true" /> Asignar integrante
        </Button>
      )}
      {available && !hasActivePeople && <p className="catalog-detail-empty">Agrega una persona activa para asignarla.</p>}
    </RecordDetails>
    <RecordDetails label="Historial de costos">
      {costs.length ? (
        <ul className="catalog-history">
          {costs.map((record) => <HistoryRow key={record.id} label={money(record.amount_cents)} period={record} status={periodStatus(record, today)} />)}
        </ul>
      ) : <p className="catalog-detail-empty">Todavía no hay costos registrados.</p>}
      <Button variant="outline" size="sm" onClick={() => open({ kind: 'cost', subscription: item, latest: costs[0] })}>
        <Plus size={16} aria-hidden="true" /> Registrar costo
      </Button>
    </RecordDetails>
  </RecordCard>
}

function AgreementCard({ item, data, today, open }: {
  item: Agreement; data: CatalogData; today: string; open: OpenEditor
}) {
  const items = data.agreement_items.filter((record) => record.agreement_id === item.id)
  const person = data.people.find((record) => record.id === item.person_id)
  const status = periodStatus(item, today)
  const isLastVersion = !data.agreements.some((record) => record.previous_agreement_id === item.id)
  const previous = data.agreements.find((record) => record.id === item.previous_agreement_id)
  return (
    <RecordCard
      icon={ClipboardList}
      name={item.name}
      detail={`${person?.name ?? 'Persona'} · ${items.length > 1 ? 'Combo' : 'Individual'}`}
      badge={<Pill label={status} active={status === 'Vigente'} />}
    >
      <div className="catalog-agreement-summary"><strong>{money(item.amount_cents)}</strong><span>{dateRange(item)}</span></div>
      <RecordDetails label={items.length > 1 ? 'Ver reparto' : 'Ver suscripción'}>
        <ul className="catalog-history catalog-agreement-items">
          {items.map((line) => (
            <li key={line.subscription_id}>
              <span>{subscriptionLabel(data.subscriptions.find((subscription) => subscription.id === line.subscription_id), data)}</span>
              <strong>{money(line.amount_cents)}</strong>
            </li>
          ))}
        </ul>
        {previous && <p className="catalog-detail-empty">Versión anterior: {money(previous.amount_cents)} · {dateRange(previous)}.</p>}
      </RecordDetails>
      {isLastVersion && <div className="catalog-agreement-actions">
        <Button variant="outline" size="sm" onClick={() => open({ kind: 'agreement', previous: item })}><Plus size={16} aria-hidden="true" /> Nueva versión</Button>
        {status !== 'Histórico' && <Button variant="ghost" size="sm" onClick={() => open({ kind: 'agreement-end', agreement: item })}>Finalizar</Button>}
      </div>}
    </RecordCard>
  )
}

function catalogRecords({ tab, data, search, today, open }: { tab: CatalogTab; data: CatalogData; search: string; today: string; open: OpenEditor }) {
  const needle = normalized(search)
  const matches = (...values: (string | undefined)[]) => values.some((value) => normalized(value ?? '').includes(needle))
  switch (tab) {
    case 'subscriptions':
      return data.subscriptions.filter((item) => matches(subscriptionLabel(item, data), item.notes)).map((item) => (
        <SubscriptionCard key={item.id} item={item} data={data} today={today} open={open} />
      ))
    case 'services':
      return data.services.filter((item) => matches(item.name, item.notes)).map((item) => {
        const subscriptions = data.subscriptions.filter((subscription) => subscription.service_id === item.id)
        return <RecordCard
          key={item.id}
          icon={Store}
          name={item.name}
          detail={`${subscriptions.length} ${subscriptions.length === 1 ? 'suscripción' : 'suscripciones'}`}
          notes={item.notes}
          badge={<Pill label={item.active ? 'Activo' : 'Inactivo'} active={Boolean(item.active)} />}
          actions={<>
            <EditButton name={item.name} onClick={() => open({ kind: 'service', item })} />
            <StateButton open={open} editor={{ kind: 'state', path: 'services', item }} />
          </>}
        />
      })
    case 'people':
      return data.people.filter((item) => matches(item.name, item.contact, item.notes)).map((item) => {
        const memberships = data.memberships.filter((membership) => membership.person_id === item.id)
        return <RecordCard
          key={item.id}
          icon={UsersRound}
          name={item.name}
          detail={item.contact}
          notes={item.notes}
          badge={<Pill label={item.active ? 'Activa' : 'Inactiva'} active={Boolean(item.active)} />}
          actions={<>
            <EditButton name={item.name} onClick={() => open({ kind: 'person', item })} />
            <StateButton open={open} editor={{ kind: 'state', path: 'people', item }} />
          </>}
        >
          <RecordDetails label="Suscripciones e historial">
            {memberships.length ? (
              <ul className="catalog-history">
                {memberships.map((record) => <HistoryRow
                  key={record.id}
                  label={subscriptionLabel(data.subscriptions.find((subscription) => subscription.id === record.subscription_id), data)}
                  period={record}
                  status={periodStatus(record, today)}
                />)}
              </ul>
            ) : <p className="catalog-detail-empty">Todavía no participa en una suscripción.</p>}
            {Boolean(item.active) && (
              <Button variant="outline" size="sm" disabled={!data.subscriptions.some((subscription) => subscriptionAvailable(subscription, data))} onClick={() => open({ kind: 'membership', personId: item.id })}>
                <Plus size={16} aria-hidden="true" /> Asignar a suscripción
              </Button>
            )}
          </RecordDetails>
        </RecordCard>
      })
    case 'accounts':
      return data.access_accounts.filter((item) => matches(item.name, item.login, item.notes)).map((item) => {
        const subscriptions = data.subscriptions.filter((subscription) => subscription.access_account_id === item.id)
        return <RecordCard
          key={item.id}
          icon={AtSign}
          name={item.name}
          detail={item.login}
          notes={item.notes}
          badge={<Pill label={item.active ? 'Activa' : 'Inactiva'} active={Boolean(item.active)} />}
          actions={<>
            <EditButton name={item.name} onClick={() => open({ kind: 'account', item })} />
            <StateButton open={open} editor={{ kind: 'state', path: 'access-accounts', item }} />
          </>}
        >
          {subscriptions.length ? (
            <RecordDetails label="Suscripciones vinculadas">
              <ul className="catalog-linked-list">
                {subscriptions.map((subscription) => <li key={subscription.id}>{subscriptionLabel(subscription, data)}</li>)}
              </ul>
            </RecordDetails>
          ) : <p className="catalog-record-notes">Sin suscripciones vinculadas.</p>}
        </RecordCard>
      })
    case 'agreements':
      return data.agreements.filter((item) => matches(item.name, data.people.find((person) => person.id === item.person_id)?.name)).map((item) => (
        <AgreementCard key={item.id} item={item} data={data} today={today} open={open} />
      ))
  }
}

function prerequisite(tab: CatalogTab, data: CatalogData): { tab: CatalogTab; message: string; action: string } | undefined {
  if (tab === 'subscriptions' && !data.services.some((item) => item.active)) {
    return { tab: 'services', message: 'Agrega o reactiva un servicio para crear una suscripción.', action: 'Ir a Servicios' }
  }
  if (tab === 'agreements' && !data.people.some((item) => item.active)) {
    return { tab: 'people', message: 'Agrega o reactiva una persona para crear un acuerdo.', action: 'Ir a Personas' }
  }
  if (tab === 'agreements' && !data.subscriptions.some((item) => subscriptionAvailable(item, data))) {
    return { tab: 'subscriptions', message: 'Agrega o reactiva una suscripción para crear un acuerdo.', action: 'Ir a Suscripciones' }
  }
}

export default function Catalog({ initialTab = 'subscriptions', onChange }: CatalogProps) {
  const [tab, setTab] = useState(initialTab)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<CatalogEditor | null>(null)
  const [data, setData] = useState<CatalogData>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    api<CatalogData>('/catalog', { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return
        setData(result)
        setError('')
      },
      (loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el catálogo.')
      },
    )
    return () => controller.abort()
  }, [revision])

  function selectTab(next: CatalogTab) {
    setTab(next)
    setSearch('')
    setNotice('')
  }

  function save(message: string) {
    setNotice(message)
    setEditor(null)
    setRevision((value) => value + 1)
    onChange?.()
  }

  const config = tabs[tab]
  const Icon = config.icon
  const needs = data && prerequisite(tab, data)
  const records = data ? catalogRecords({ tab, data, search, today: localDate(), open: setEditor }) : []
  return <section className="catalog" aria-labelledby="catalog-heading">
    <header className="catalog-heading">
      <h1 id="catalog-heading">Catálogo</h1>
      <p>Administra tus servicios, grupos y acuerdos de cobro.</p>
    </header>
    <Tabs.Root value={tab} onValueChange={(next) => selectTab(next as CatalogTab)}>
      <Tabs.List className="catalog-tabs" aria-label="Secciones del catálogo">
        {(Object.keys(tabs) as CatalogTab[]).map((key) => {
          const TabIcon = tabs[key].icon
          return <Tabs.Trigger className="catalog-tab" key={key} value={key}><TabIcon size={17} aria-hidden="true" /> {tabs[key].label}</Tabs.Trigger>
        })}
      </Tabs.List>
      {(Object.keys(tabs) as CatalogTab[]).map((key) => (
        <Tabs.Content className="catalog-content" key={key} value={key}>
          {key === tab && <>
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  aria-label={`Buscar en ${config.label.toLowerCase()}`}
                  placeholder={`Buscar ${config.label.toLowerCase()}…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <Button onClick={() => setEditor(config.editor)} disabled={!data || Boolean(needs)}>
                <Plus size={17} aria-hidden="true" /> {config.add}
              </Button>
            </div>
            {notice && <p className="catalog-notice" role="status">{notice}</p>}
            {error && (
              <div className="catalog-load-error">
                <p className="catalog-error" role="alert">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(''); setRevision((value) => value + 1) }}>Reintentar</Button>
              </div>
            )}
            {!data && !error && <p className="catalog-loading" role="status">Cargando catálogo…</p>}
            {needs && (
              <div className="catalog-prerequisite">
                <p>{needs.message}</p>
                <Button variant="outline" size="sm" onClick={() => selectTab(needs.tab)}>{needs.action}</Button>
              </div>
            )}
            {!!records.length && <div className="catalog-records">{records}</div>}
            {data && !records.length && (
              <div className="catalog-empty">
                <span className="catalog-record-icon"><Icon size={24} aria-hidden="true" /></span>
                <p>{search.trim() ? 'No encontramos registros con esa búsqueda.' : config.empty}</p>
              </div>
            )}
          </>}
        </Tabs.Content>
      ))}
    </Tabs.Root>
    {data && editor && <CatalogForm editor={editor} data={data} onClose={() => setEditor(null)} onSaved={save} />}
  </section>
}
