import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CircleHelp, Clock3, Files, type LucideIcon } from 'lucide-react'
import {
  chargeInputSchema,
  expenseInputSchema,
  issueAgreementInputSchema,
  paymentInputSchema,
  type Charge,
  type IssuedAgreement,
} from '@gestor/shared/finance'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { api, displayDate, localDate, money, toCents, useApi, type FinanceCatalog, type Operation } from './finance-model'

export const operationInfo: Record<Operation, { title: string; label: string; hint: string; icon: LucideIcon }> = {
  expense: { title: 'Registrar gasto', label: 'Gasto', hint: 'Anota lo que pagaste por una suscripción.', icon: ArrowUpRight },
  charge: { title: 'Crear cargo', label: 'Cargo', hint: 'Registra un importe pendiente de cobro.', icon: Clock3 },
  payment: { title: 'Registrar pago', label: 'Pago', hint: 'Aplica un pago total o parcial a un cargo.', icon: ArrowDownLeft },
  agreement: { title: 'Emitir cargos de un acuerdo', label: 'Acuerdo', hint: 'Crea los cargos según la distribución del acuerdo.', icon: Files },
}

type SetupTab = 'subscriptions' | 'people' | 'agreements'

type FinanceOperationDialogProps = {
  operation: Operation | 'pick' | null
  initialChargeId?: number
  catalog: FinanceCatalog | undefined
  catalogError?: string
  onChoose: (operation: Operation) => void
  onClose: () => void
  onSetup: (tab: SetupTab) => void
  onSuccess: (message: string) => void
  onRetryCatalog: () => void
}

export function FinanceOperationDialog({ operation, initialChargeId, catalog, catalogError, onChoose, onClose, onSetup, onSuccess, onRetryCatalog }: FinanceOperationDialogProps) {
  const [busy, setBusy] = useState(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const previousOperation = useRef(operation)
  const info = operation && operation !== 'pick' ? operationInfo[operation] : null

  useLayoutEffect(() => {
    if (previousOperation.current === 'pick' && operation && operation !== 'pick') title.current?.focus()
    previousOperation.current = operation
  }, [operation])

  return (
    <Dialog open={Boolean(operation)} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent
        busy={busy}
        onOpenAutoFocus={(event) => {
          if (document.activeElement instanceof HTMLElement && document.activeElement !== title.current) returnFocus.current = document.activeElement
          event.preventDefault()
          title.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
      >
        <div className="ui-dialog-header">
          <DialogTitle className="ui-dialog-title" tabIndex={-1} ref={title}>{info?.title ?? 'Registrar movimiento'}</DialogTitle>
          <DialogDescription className="ui-dialog-description">{info?.hint ?? 'Elige el tipo de operación que quieres registrar.'}</DialogDescription>
        </div>
        {operation === 'pick' && (
          <div className="operation-picker">
            {(Object.keys(operationInfo) as Operation[]).map((item) => {
              const { icon: Icon, title, hint } = operationInfo[item]
              return (
                <button className="operation-option" key={item} type="button" onClick={() => onChoose(item)}>
                  <span className={`movement-icon kind-${item}`}><Icon size={19} aria-hidden="true" /></span>
                  <span><strong>{title}</strong><small>{hint}</small></span>
                  <ArrowRight className="operation-arrow" size={17} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
        {operation && operation !== 'pick' && (
          <OperationForm
            key={`${operation}-${initialChargeId ?? ''}`}
            operation={operation}
            initialChargeId={initialChargeId}
            catalog={catalog}
            catalogError={catalogError}
            busy={busy}
            setBusy={setBusy}
            onSetup={onSetup}
            onSuccess={onSuccess}
            onClose={onClose}
            onRetryCatalog={onRetryCatalog}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type OperationFormProps = Pick<FinanceOperationDialogProps, 'initialChargeId' | 'catalog' | 'catalogError' | 'onSetup' | 'onSuccess' | 'onClose' | 'onRetryCatalog'> & {
  operation: Operation
  busy: boolean
  setBusy: (busy: boolean) => void
}

function OperationForm({ operation, initialChargeId, catalog, catalogError, busy, setBusy, onSetup, onSuccess, onClose, onRetryCatalog }: OperationFormProps) {
  const [date, setDate] = useState(localDate)
  const [chargeId, setChargeId] = useState(initialChargeId === undefined ? '' : String(initialChargeId))
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const inFlight = useRef(false)
  const submission = useRef<{ body: string; key: string } | null>(null)
  const isPayment = operation === 'payment'
  const isAgreement = operation === 'agreement'
  const requiresDue = isAgreement || operation === 'charge'
  const pending = useApi<Charge[]>(isPayment ? '/charges?pending=1' : null, retry)
  const selectedCharge = pending.data?.find((charge) => String(charge.id) === chargeId)
  const agreements = catalog?.agreements.filter((agreement) => agreement.start_date <= date && (!agreement.end_date || date < agreement.end_date)) ?? []
  const services = new Map(catalog?.services.map((item) => [item.id, item]))
  const people = new Map(catalog?.people.map((item) => [item.id, item]))
  const subscriptions = catalog?.subscriptions.filter((item) => item.active && services.get(item.service_id)?.active) ?? []
  const activePeople = catalog?.people.filter((item) => item.active) ?? []

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    setError('')
    const fields = new FormData(event.currentTarget)
    const amount = toCents(String(fields.get('amount') ?? ''))
    const note = String(fields.get('note') ?? '').trim() || undefined
    const due = String(fields.get('due') ?? '') || undefined
    const subscription = Number(fields.get('subscription'))
    const person = Number(fields.get('person'))
    const agreement = Number(fields.get('agreement'))

    if (!isAgreement && !amount) {
      setError('Ingresa un importe mayor que cero, con hasta dos decimales.')
      return
    }
    if (isPayment && (!selectedCharge || (amount ?? 0) > selectedCharge.pending_cents)) {
      setError('Selecciona un cargo e ingresa un importe que no exceda su saldo pendiente.')
      return
    }

    const endpoint = isPayment ? `/charges/${chargeId}/payments` : isAgreement ? `/agreements/${agreement}/issue` : operation === 'expense' ? '/expenses' : '/charges'
    const result = isPayment ? paymentInputSchema.safeParse({ amount_cents: amount, received_on: date, note })
      : isAgreement ? issueAgreementInputSchema.safeParse({ issued_on: date, due_on: due, note })
      : operation === 'expense' ? expenseInputSchema.safeParse({ subscription_id: subscription, amount_cents: amount, paid_on: date, note })
      : chargeInputSchema.safeParse({ subscription_id: subscription, person_id: person, amount_cents: amount, issued_on: date, due_on: due, note })
    if (!result.success) {
      setError(result.error.issues[0]?.message || 'Revisa los datos ingresados.')
      return
    }

    const body = JSON.stringify({ endpoint, ...result.data })
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() }
    inFlight.current = true
    setBusy(true)
    try {
      const response = await api<IssuedAgreement>(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...result.data, idempotency_key: submission.current.key }),
      })
      const count = isAgreement ? response.charges.length : 0
      const message = isAgreement ? `${count} ${count === 1 ? 'cargo emitido' : 'cargos emitidos'}.`
        : isPayment ? 'Pago registrado.' : operation === 'expense' ? 'Gasto registrado.' : 'Cargo creado.'
      onSuccess(message)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo guardar el movimiento.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const fetching = isPayment ? pending.loading : !catalog && !catalogError
  const failure = isPayment ? pending.error : catalogError
  if (fetching) return <p className="form-message" role="status">Cargando opciones…</p>
  if (failure) return (
    <div className="form-message">
      <p role="alert">{failure}</p>
      <Button variant="outline" size="sm" onClick={isPayment ? () => setRetry((value) => value + 1) : onRetryCatalog}>Reintentar</Button>
    </div>
  )
  if (isPayment && !pending.data?.length) return (
    <div className="form-message"><p>No hay cargos pendientes para registrar un pago.</p><Button variant="outline" onClick={onClose}>Cerrar</Button></div>
  )

  let setup: { tab: SetupTab; message: string; label: string } | undefined
  if (isAgreement && !catalog?.agreements.length) setup = { tab: 'agreements', message: 'Crea un acuerdo con una distribución por suscripción para emitir sus cargos.', label: 'Ir a Acuerdos' }
  if (!isPayment && !isAgreement && !subscriptions.length) setup = { tab: 'subscriptions', message: 'Necesitas una suscripción activa de un servicio activo para registrar este movimiento.', label: 'Ir a Suscripciones' }
  if (operation === 'charge' && !setup && !activePeople.length) setup = { tab: 'people', message: 'Necesitas una persona activa en el catálogo para asignarle el cargo.', label: 'Ir a Personas' }
  if (setup) {
    const { tab, message, label } = setup
    return <div className="form-message"><p>{message}</p><Button onClick={() => onSetup(tab)}>{label}<ArrowRight size={17} aria-hidden="true" /></Button></div>
  }

  return (
    <form className="operation-form" onSubmit={handleSubmit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <div className="fields-row">
          <label>
            <span>{isPayment ? 'Fecha del pago' : operation === 'expense' ? 'Fecha del gasto' : 'Fecha de emisión'}</span>
            <input type="date" required value={date} min={isPayment ? selectedCharge?.issued_on : '0001-01-01'} max={isPayment || operation === 'expense' ? localDate() : '9999-12-31'} onChange={(event) => setDate(event.target.value)} />
          </label>
          {requiresDue && (
            <label>
              <span>Vencimiento <small>Opcional</small></span>
              <input type="date" name="due" min={date || '0001-01-01'} max="9999-12-31" />
            </label>
          )}
        </div>
        {isAgreement && (
          <label>
            <span>Acuerdo vigente</span>
            <select name="agreement" defaultValue="" required>
              <option value="" disabled>{agreements.length ? 'Selecciona un acuerdo' : 'Sin acuerdos vigentes en esta fecha'}</option>
              {agreements.map((agreement) => <option value={agreement.id} key={agreement.id}>{agreement.name} · {people.get(agreement.person_id)?.name} · {money(agreement.amount_cents)}</option>)}
            </select>
          </label>
        )}
        {isPayment && (
          <label>
            <span>Cargo pendiente</span>
            <select value={selectedCharge ? chargeId : ''} onChange={(event) => setChargeId(event.target.value)} required>
              <option value="" disabled>Selecciona un cargo</option>
              {pending.data?.map((charge) => <option value={charge.id} key={charge.id}>{charge.person_name} · {charge.subscription_name} · {displayDate(charge.issued_on)} · {money(charge.pending_cents)}</option>)}
            </select>
            {initialChargeId !== undefined && !pending.data?.some((charge) => charge.id === initialChargeId) && <small>El cargo elegido no figura entre los pendientes de hoy.</small>}
          </label>
        )}
        {!isPayment && !isAgreement && (
          <label>
            <span>Suscripción</span>
            <select name="subscription" defaultValue="" required>
              <option value="" disabled>Selecciona una suscripción</option>
              {subscriptions.map((subscription) => {
                const service = services.get(subscription.service_id)?.name
                return <option value={subscription.id} key={subscription.id}>{service && service !== subscription.name ? `${service} · ` : ''}{subscription.name}</option>
              })}
            </select>
          </label>
        )}
        {operation === 'charge' && (
          <label>
            <span>Persona</span>
            <select name="person" defaultValue="" required>
              <option value="" disabled>Selecciona una persona</option>
              {activePeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}
            </select>
          </label>
        )}
        {!isAgreement && (
          <div className="amount-field">
            <label>
              <span>Importe en bolivianos</span>
              <div className="amount-input">
                <span aria-hidden="true">Bs</span>
                <input name="amount" type="text" inputMode="decimal" required placeholder="0,00" maxLength={22} aria-describedby={selectedCharge ? 'payment-balance' : undefined} />
              </div>
            </label>
            {selectedCharge && <small className="field-hint" id="payment-balance">Saldo disponible para abonar: {money(selectedCharge.pending_cents)}</small>}
          </div>
        )}
        <label>
          <span>Nota <small>Opcional</small></span>
          <textarea name="note" rows={2} maxLength={1000} placeholder="Añade un detalle del movimiento" />
        </label>
        {isAgreement && <p className="field-hint agreement-hint"><CircleHelp size={16} aria-hidden="true" /> Cada suscripción del acuerdo generará su propio cargo.</p>}
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="ui-dialog-footer">
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" disabled={busy || (isAgreement && !agreements.length)}>{busy ? 'Guardando…' : isAgreement ? 'Emitir cargos' : 'Guardar'}</Button>
      </div>
    </form>
  )
}
