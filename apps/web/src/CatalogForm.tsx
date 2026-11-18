import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ZodError } from 'zod'
import {
  accessAccountInput,
  agreementInput,
  catalogStateInput,
  costInput,
  endDateInput,
  membershipInput,
  membershipMoveInput,
  personInput,
  serviceInput,
  subscriptionEditInput,
  subscriptionInput,
  type AccessAccount,
  type Agreement,
  type CatalogData,
  type Membership,
  type Person,
  type Service,
  type ServiceCost,
  type Subscription,
} from '@gestor/shared/catalog'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { api, localDate, money, toCents } from './finance-model'

type StatePath = 'services' | 'people' | 'access-accounts' | 'subscriptions'
export type CatalogEditor =
  | { kind: 'service'; item?: Service }
  | { kind: 'person'; item?: Person }
  | { kind: 'account'; item?: AccessAccount }
  | { kind: 'subscription'; item?: Subscription }
  | { kind: 'state'; path: StatePath; item: Service | Person | AccessAccount | Subscription }
  | { kind: 'membership'; subscriptionId?: number; personId?: number }
  | { kind: 'move'; membership: Membership }
  | { kind: 'membership-end'; membership: Membership }
  | { kind: 'cost'; subscription: Subscription; latest?: ServiceCost }
  | { kind: 'agreement'; previous?: Agreement }
  | { kind: 'agreement-end'; agreement: Agreement }

type Allocation = { key: number; subscription: string; amount: string }
type NamedOption = { id: number; name: string; active: 0 | 1 }

export function subscriptionLabel(subscription: Subscription | undefined, data: CatalogData) {
  if (!subscription) return 'Suscripción'
  const service = data.services.find((item) => item.id === subscription.service_id)
  return service && service.name !== subscription.name ? `${service.name} · ${subscription.name}` : subscription.name
}

export function subscriptionAvailable(subscription: Subscription, data: CatalogData) {
  return Boolean(subscription.active && data.services.some((service) => service.id === subscription.service_id && service.active))
}

function catalogCents(value: string) {
  return /^0+(?:[.,]0{1,2})?$/.test(value.trim()) ? 0 : toCents(value)
}

function amountText(value: number) {
  return (value / 100).toFixed(2)
}

function maxDate(a: string, b: string) {
  return a > b ? a : b
}

function editorInfo(editor: CatalogEditor): { title: string; description: string } {
  switch (editor.kind) {
    case 'service': return { title: editor.item ? 'Editar servicio' : 'Nuevo servicio', description: 'Registra la plataforma que presta el servicio digital.' }
    case 'person': return { title: editor.item ? 'Editar persona' : 'Nueva persona', description: 'Registra a quien participa en tus suscripciones.' }
    case 'account': return { title: editor.item ? 'Editar cuenta' : 'Nueva cuenta de acceso', description: 'Puedes usar la misma cuenta para varias suscripciones y servicios.' }
    case 'subscription': return { title: editor.item ? 'Editar suscripción' : 'Nueva suscripción', description: 'Identifica el plan de un servicio y, si corresponde, vincula su cuenta de acceso.' }
    case 'state': return editor.item.active
      ? { title: 'Desactivar registro', description: `Desactiva «${editor.item.name}» y conserva sus relaciones e historial.` }
      : { title: 'Reactivar registro', description: `Vuelve a habilitar «${editor.item.name}».` }
    case 'membership': return { title: 'Asignar integrante', description: 'Indica desde cuándo participa la persona en la suscripción.' }
    case 'move': return { title: 'Trasladar integrante', description: 'La asignación original termina el día en que comienza la nueva.' }
    case 'membership-end': return { title: 'Retirar integrante', description: 'La fecha de retiro es el primer día fuera del grupo.' }
    case 'cost': return { title: 'Registrar costo', description: `Indica el costo de «${editor.subscription.name}» y su fecha de vigencia.` }
    case 'agreement': return editor.previous
      ? { title: 'Nueva versión del acuerdo', description: 'Conserva el precio y reparto anteriores en el historial de versiones.' }
      : { title: 'Nuevo acuerdo', description: 'Fija un precio para una suscripción o distribuye el total de un combo.' }
    case 'agreement-end': return { title: 'Finalizar acuerdo', description: 'La fecha de fin es el primer día fuera de vigencia.' }
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="catalog-field"><span>{label}</span>{children}</label>
}

function DateInput({ name, initial, min, max }: { name: string; initial?: string; min?: string; max?: string }) {
  return <input type="date" name={name} defaultValue={initial ?? ''} min={min} max={max} required={name === 'start_date' || Boolean(initial)} />
}

function DateRange({ start, end, min }: { start: string; end?: string; min?: string }) {
  return (
    <>
      <div className="catalog-field-pair">
        <Field label="Fecha de inicio"><DateInput name="start_date" initial={start} min={min} /></Field>
        <Field label="Fecha de fin (opcional)"><input type="date" name="end_date" defaultValue={end ?? ''} /></Field>
      </div>
      <small className="catalog-field-hint">La fecha de fin es el primer día fuera de vigencia.</small>
    </>
  )
}

function Options({ values, selected, optional, omit }: { values: NamedOption[]; selected?: number; optional?: string; omit?: number }) {
  return <>
    <option value="">{optional ?? 'Selecciona una opción'}</option>
    {values.filter((value) => (value.active || value.id === selected) && value.id !== omit).map((value) => (
      <option key={value.id} value={value.id}>{value.name}{value.active ? '' : ' (inactivo)'}</option>
    ))}
  </>
}

function SelectField({ label, name, values, selected, optional, disabled, omit }: {
  label: string; name: string; values: NamedOption[]; selected?: number; optional?: string; disabled?: boolean; omit?: number
}) {
  return (
    <Field label={label}>
      <select name={name} defaultValue={selected ?? ''} required={!optional} disabled={disabled}>
        <Options values={values} selected={selected} optional={optional} omit={omit} />
      </select>
    </Field>
  )
}

function AmountInput(props: React.ComponentProps<'input'>) {
  return <input inputMode="decimal" placeholder="0,00" maxLength={12} required {...props} />
}

function entityFields(editor: Extract<CatalogEditor, { kind: 'service' | 'person' | 'account' | 'subscription' }>, data: CatalogData) {
  return (
    <>
      {editor.kind === 'subscription' && (
        <SelectField label="Servicio" name="service_id" values={data.services} selected={editor.item?.service_id} disabled={Boolean(editor.item)} />
      )}
      <Field label="Nombre"><input name="name" defaultValue={editor.item?.name} maxLength={120} required /></Field>
      {editor.kind === 'person' && (
        <Field label="Teléfono o correo (opcional)"><input name="contact" defaultValue={editor.item?.contact} maxLength={240} /></Field>
      )}
      {editor.kind === 'account' && (
        <Field label="Correo o usuario">
          <input name="login" defaultValue={editor.item?.login} maxLength={320} autoComplete="off" required />
        </Field>
      )}
      {editor.kind === 'subscription' && (
        <SelectField label="Cuenta de acceso" name="access_account_id" values={data.access_accounts} selected={editor.item?.access_account_id ?? undefined} optional="Sin cuenta vinculada" />
      )}
      <Field label="Notas (opcional)"><textarea name="notes" defaultValue={editor.item?.notes} maxLength={2000} rows={3} /></Field>
    </>
  )
}

function entityChange<T>(path: string, id: number | undefined, body: T) {
  return { path: id ? `${path}/${id}` : path, method: id ? 'PATCH' : 'POST', body }
}

function getChange(editor: CatalogEditor, form: FormData, allocations: Allocation[], total: string) {
  const value = (key: string) => String(form.get(key) ?? '')
  const numericId = (key: string) => Number(value(key))
  const details = { name: value('name'), notes: value('notes') }
  switch (editor.kind) {
    case 'service':
      return entityChange('/services', editor.item?.id, serviceInput.parse(details))
    case 'person':
      return entityChange('/people', editor.item?.id, personInput.parse({ ...details, contact: value('contact') }))
    case 'account':
      return entityChange('/access-accounts', editor.item?.id, accessAccountInput.parse({ ...details, login: value('login') }))
    case 'subscription': {
      const subscription = { ...details, access_account_id: numericId('access_account_id') || null }
      const body = editor.item
        ? subscriptionEditInput.parse(subscription)
        : subscriptionInput.parse({ ...subscription, service_id: numericId('service_id') })
      return entityChange('/subscriptions', editor.item?.id, body)
    }
    case 'state':
      return { path: `/${editor.path}/${editor.item.id}/state`, method: 'PATCH', body: catalogStateInput.parse({ active: editor.item.active ? 0 : 1 }) }
    case 'membership':
      return entityChange('/memberships', undefined, membershipInput.parse({
        person_id: numericId('person_id'),
        subscription_id: numericId('subscription_id'),
        start_date: value('start_date'),
        end_date: value('end_date') || null,
      }))
    case 'move':
      return entityChange(`/memberships/${editor.membership.id}/move`, undefined, membershipMoveInput.parse({
        subscription_id: numericId('subscription_id'),
        start_date: value('start_date'),
      }))
    case 'membership-end':
      return entityChange(`/memberships/${editor.membership.id}/end`, undefined, endDateInput.parse({ end_date: value('end_date') }))
    case 'cost':
      return entityChange(`/subscriptions/${editor.subscription.id}/costs`, undefined, costInput.parse({
        start_date: value('start_date'),
        amount_cents: catalogCents(value('amount')),
      }))
    case 'agreement': {
      const amount = catalogCents(total)
      return entityChange(editor.previous ? `/agreements/${editor.previous.id}/versions` : '/agreements', undefined, agreementInput.parse({
        name: value('name'),
        person_id: editor.previous?.person_id ?? numericId('person_id'),
        amount_cents: amount,
        start_date: value('start_date'),
        end_date: value('end_date') || null,
        items: allocations.map((item) => ({
          subscription_id: Number(item.subscription),
          amount_cents: allocations.length === 1 ? amount : catalogCents(item.amount),
        })),
      }))
    }
    case 'agreement-end':
      return entityChange(`/agreements/${editor.agreement.id}/end`, undefined, endDateInput.parse({ end_date: value('end_date') }))
  }
}

type CatalogFormProps = {
  editor: CatalogEditor
  data: CatalogData
  onClose: () => void
  onSaved: (message: string) => void
}

export function CatalogForm({ editor, data, onClose, onSaved }: CatalogFormProps) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const previous = editor.kind === 'agreement' ? editor.previous : undefined
  const [total, setTotal] = useState(() => previous ? amountText(previous.amount_cents) : '')
  const [allocations, setAllocations] = useState<Allocation[]>(() => {
    if (!previous) return [{ key: 0, subscription: '', amount: '' }]
    return data.agreement_items.filter((item) => item.agreement_id === previous.id).map((item, key) => ({
      key, subscription: String(item.subscription_id), amount: amountText(item.amount_cents),
    }))
  })
  const nextKey = useRef(allocations.length)
  const info = editorInfo(editor)
  const subscriptions: NamedOption[] = data.subscriptions.map((subscription) => ({
    id: subscription.id,
    name: subscriptionLabel(subscription, data),
    active: subscriptionAvailable(subscription, data) ? 1 : 0,
  }))
  const today = localDate()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    try {
      const change = getChange(editor, new FormData(event.currentTarget), allocations, total)
      inFlight.current = true
      setBusy(true)
      await api<{ id: number }>(change.path, {
        method: change.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change.body),
      })
      onSaved(editor.kind === 'move' ? 'Integrante trasladado.' : 'Cambios guardados.')
    } catch (requestError) {
      setError(requestError instanceof ZodError
        ? requestError.issues[0]?.message ?? 'Revisa los datos ingresados.'
        : requestError instanceof Error ? requestError.message : 'No se pudieron guardar los cambios.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  function updateAllocation(key: number, update: Partial<Omit<Allocation, 'key'>>) {
    setAllocations((rows) => rows.map((row) => row.key === key ? { ...row, ...update } : row))
  }

  function addAllocation() {
    const key = nextKey.current++
    setAllocations((rows) => [...rows, { key, subscription: '', amount: '' }])
  }

  function splitAmount() {
    const amount = catalogCents(total)
    if (amount === undefined) return
    const partial = Math.floor(amount / allocations.length)
    const remainder = amount % allocations.length
    setAllocations((rows) => rows.map((row, index) => ({ ...row, amount: amountText(partial + Number(index < remainder)) })))
  }

  function agreementFields() {
    const hasCombo = allocations.length > 1
    const totalCents = catalogCents(total)
    const distributed = allocations.reduce((sum, item) => sum + (catalogCents(item.amount) ?? 0), 0)
    const start = maxDate(today, previous?.start_date ?? today)
    return (
      <>
        <Field label="Nombre del acuerdo"><input name="name" defaultValue={previous?.name} maxLength={120} required /></Field>
        <SelectField label="Persona" name="person_id" values={data.people} selected={previous?.person_id} disabled={Boolean(previous)} />
        <DateRange start={start} end={previous?.end_date && previous.end_date > start ? previous.end_date : undefined} min={previous?.start_date} />
        <Field label="Importe total (Bs)"><AmountInput value={total} onChange={(event) => setTotal(event.target.value)} /></Field>
        <fieldset className="catalog-allocation">
          <legend>{hasCombo ? 'Reparto del combo' : 'Suscripción del acuerdo'}</legend>
          {allocations.map((item, index) => (
            <div className={hasCombo ? 'catalog-allocation-row' : undefined} key={item.key}>
              <label className="catalog-field">
                {hasCombo && <span>Suscripción {index + 1}</span>}
                <select
                  aria-label={hasCombo ? undefined : 'Suscripción'}
                  value={item.subscription}
                  onChange={(event) => updateAllocation(item.key, { subscription: event.target.value })}
                  required
                >
                  <Options
                    values={subscriptions.filter((subscription) => !allocations.some((row) => row.key !== item.key && row.subscription === String(subscription.id)))}
                    selected={Number(item.subscription)}
                  />
                </select>
              </label>
              {hasCombo && (
                <>
                  <Field label="Importe (Bs)"><AmountInput value={item.amount} onChange={(event) => updateAllocation(item.key, { amount: event.target.value })} /></Field>
                  <Button size="icon" variant="ghost" aria-label={`Quitar suscripción ${index + 1}`} onClick={() => setAllocations((rows) => rows.filter((row) => row.key !== item.key))}>
                    <Trash2 size={17} aria-hidden="true" />
                  </Button>
                </>
              )}
            </div>
          ))}
          <div className="catalog-allocation-actions">
            {allocations.length < subscriptions.filter((item) => item.active || allocations.some((row) => row.subscription === String(item.id))).length && (
              <Button variant="outline" size="sm" onClick={addAllocation}><Plus size={15} aria-hidden="true" /> Agregar suscripción</Button>
            )}
            {hasCombo && (
              <Button variant="ghost" size="sm" disabled={totalCents === undefined} onClick={splitAmount}>Repartir por igual</Button>
            )}
          </div>
          {hasCombo && totalCents !== undefined && <small className="catalog-field-hint">Repartido {money(distributed)} de {money(totalCents)}</small>}
        </fieldset>
      </>
    )
  }

  function fields() {
    switch (editor.kind) {
      case 'service':
      case 'person':
      case 'account':
      case 'subscription':
        return entityFields(editor, data)
      case 'state':
        return null
      case 'membership':
        return <>
          <SelectField label="Persona" name="person_id" values={data.people} selected={editor.personId} />
          <SelectField label="Suscripción" name="subscription_id" values={subscriptions} selected={editor.subscriptionId} />
          <DateRange start={today} />
        </>
      case 'move':
        return <>
          <SelectField label="Suscripción de destino" name="subscription_id" values={subscriptions} omit={editor.membership.subscription_id} />
          <Field label="Fecha de traslado">
            <DateInput name="start_date" initial={maxDate(today, editor.membership.start_date)} min={editor.membership.start_date} max={editor.membership.end_date ?? undefined} />
          </Field>
        </>
      case 'membership-end':
        return <Field label="Fecha de retiro">
          <DateInput name="end_date" initial={maxDate(today, editor.membership.start_date)} min={editor.membership.start_date} max={editor.membership.end_date ?? undefined} />
        </Field>
      case 'cost':
        return <>
          <Field label="Costo (Bs)"><AmountInput name="amount" defaultValue={editor.latest ? amountText(editor.latest.amount_cents) : ''} /></Field>
          <Field label="Vigente desde"><DateInput name="start_date" initial={maxDate(today, editor.latest?.start_date ?? today)} min={editor.latest?.start_date} /></Field>
        </>
      case 'agreement':
        return agreementFields()
      case 'agreement-end':
        return <Field label="Fecha de fin">
          <DateInput name="end_date" initial={maxDate(today, editor.agreement.start_date)} min={editor.agreement.start_date} max={editor.agreement.end_date ?? undefined} />
        </Field>
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent
        busy={busy}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
      >
        <div className="ui-dialog-header">
          <DialogTitle className="ui-dialog-title">{info.title}</DialogTitle>
          <DialogDescription className="ui-dialog-description">{info.description}</DialogDescription>
        </div>
        <form className="catalog-form" onSubmit={submit}>
          <fieldset disabled={busy} className="catalog-form-fields">{fields()}</fieldset>
          {error && <p className="catalog-error" role="alert">{error}</p>}
          <div className="catalog-dialog-actions">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : editor.kind === 'state' ? (editor.item.active ? 'Desactivar' : 'Reactivar') : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
