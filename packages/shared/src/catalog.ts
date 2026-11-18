import { z } from './zod'

export const catalogId = z.number({ error: 'Selecciona un registro válido.' })
  .int('Selecciona un registro válido.')
  .positive('Selecciona un registro válido.')
  .max(Number.MAX_SAFE_INTEGER, 'Selecciona un registro válido.')
export const catalogDate = z.iso.date({ error: 'Ingresa una fecha válida.' })
  .refine((value) => value >= '0001-01-01', { message: 'Ingresa una fecha válida.' })
export const catalogAmount = z.number({ error: 'Ingresa un importe con hasta dos decimales.' })
  .int('Ingresa un importe con hasta dos decimales.')
  .min(0, 'El importe debe ser cero o mayor.')
  .max(999_999_999, 'El importe supera el máximo permitido.')

const name = z.string().trim().min(1, 'Ingresa un nombre.').max(120, 'Usa hasta 120 caracteres.')
const notes = z.string().trim().max(2000, 'Usa hasta 2000 caracteres.').default('')
const active = z.union([z.literal(0), z.literal(1)])
const range = {
  start_date: catalogDate,
  end_date: catalogDate.nullable().default(null),
}

export const serviceInput = z.object({ name, notes }).strict()
export const personInput = serviceInput.extend({
  contact: z.string().trim().max(240, 'Usa hasta 240 caracteres.').default(''),
})
export const accessAccountInput = serviceInput.extend({
  login: z.string().trim().min(1, 'Ingresa un correo o usuario.').max(320, 'Usa hasta 320 caracteres.'),
})
export const subscriptionEditInput = serviceInput.extend({
  access_account_id: catalogId.nullable().default(null),
})
export const subscriptionInput = subscriptionEditInput.extend({ service_id: catalogId })
export const catalogStateInput = z.object({ active }).strict()
export const membershipInput = z.object({
  person_id: catalogId,
  subscription_id: catalogId,
  ...range,
}).strict().refine(validRange, { message: 'El fin debe ser posterior al inicio.', path: ['end_date'] })
export const membershipMoveInput = z.object({
  subscription_id: catalogId,
  start_date: catalogDate,
}).strict()
export const endDateInput = z.object({ end_date: catalogDate }).strict()
export const costInput = z.object({
  start_date: catalogDate,
  amount_cents: catalogAmount,
}).strict()

const agreementItemInput = z.object({
  subscription_id: catalogId,
  amount_cents: catalogAmount,
}).strict()
export const agreementInput = z.object({
  person_id: catalogId,
  name,
  ...range,
  amount_cents: catalogAmount,
  items: z.array(agreementItemInput).min(1, 'Asigna el importe a por lo menos una suscripción.'),
}).strict().refine(validRange, {
  message: 'El fin debe ser posterior al inicio.',
  path: ['end_date'],
}).superRefine(({ amount_cents, items }, context) => {
  if (new Set(items.map((item) => item.subscription_id)).size !== items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Cada suscripción puede aparecer una sola vez.' })
  }
  if (items.reduce((sum, item) => sum + item.amount_cents, 0) !== amount_cents) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'El reparto debe sumar el importe total.' })
  }
})

function validRange(values: { start_date: string; end_date: string | null }) {
  return values.end_date === null || values.end_date > values.start_date
}

export type Service = z.infer<typeof serviceInput> & { id: number; active: 0 | 1 }
export type Person = z.infer<typeof personInput> & { id: number; active: 0 | 1 }
export type AccessAccount = z.infer<typeof accessAccountInput> & { id: number; active: 0 | 1 }
export type Subscription = z.infer<typeof subscriptionInput> & { id: number; active: 0 | 1 }
export type Membership = z.infer<typeof membershipInput> & { id: number }
export type ServiceCost = z.infer<typeof costInput> & { id: number; subscription_id: number; end_date: string | null }
export type Agreement = Omit<z.infer<typeof agreementInput>, 'items'> & {
  id: number
  previous_agreement_id: number | null
}
export type AgreementItem = z.infer<typeof agreementItemInput> & { agreement_id: number }

export interface CatalogData {
  services: Service[]
  people: Person[]
  access_accounts: AccessAccount[]
  subscriptions: Subscription[]
  memberships: Membership[]
  agreements: Agreement[]
  agreement_items: AgreementItem[]
  service_cost_history: ServiceCost[]
}
