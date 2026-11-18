import { z } from './zod'

export const financeDateSchema = z.string()
  .regex(/^(?!0000)\d{4}-\d{2}-\d{2}$/, 'Usa una fecha con formato AAAA-MM-DD.')
  .refine(value => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, 'La fecha debe existir en el calendario.')

export const amountCentsSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const queryId = z.coerce.number().pipe(id)
const note = z.string().trim().max(1000).nullish().transform(value => value || null)
const idempotencyKey = z.string().uuid().transform(value => value.toLowerCase()).optional()

const chargeDates = {
  issued_on: financeDateSchema,
  due_on: financeDateSchema.nullish().transform(value => value ?? null),
}

function validDueDate(value: { issued_on: string; due_on: string | null }) {
  return value.due_on === null || value.due_on >= value.issued_on
}

const dueDateError = {
  path: ['due_on'],
  message: 'El vencimiento debe ser el día de emisión o posterior.',
}

export const expenseInputSchema = z.object({
  subscription_id: id,
  amount_cents: amountCentsSchema,
  paid_on: financeDateSchema,
  note,
  idempotency_key: idempotencyKey,
}).strict()

export const chargeInputSchema = z.object({
  person_id: id,
  subscription_id: id,
  amount_cents: amountCentsSchema,
  ...chargeDates,
  note,
  idempotency_key: idempotencyKey,
}).strict().refine(validDueDate, dueDateError)

export const paymentInputSchema = z.object({
  amount_cents: amountCentsSchema,
  received_on: financeDateSchema,
  note,
  idempotency_key: idempotencyKey,
}).strict()

export const issueAgreementInputSchema = z.object({
  ...chargeDates,
  note,
  idempotency_key: idempotencyKey,
}).strict().refine(validDueDate, dueDateError)

export const financeFiltersSchema = z.object({
  from: financeDateSchema.optional(),
  to: financeDateSchema.optional(),
  service_id: queryId.optional(),
  person_id: queryId.optional(),
  pending: z.enum(['0', '1']).optional(),
}).refine(value => !value.from || !value.to || value.from <= value.to, {
  path: ['to'],
  message: 'El final del periodo debe ser igual o posterior al inicio.',
})

export type FinanceFilters = z.infer<typeof financeFiltersSchema>

interface SubscriptionDetails {
  subscription_id: number
  subscription_name: string
  service_id: number
  service_name: string
}

interface FinancialEntry {
  id: number
  amount_cents: number
  note: string | null
}

interface PersonDetails {
  person_id: number
  person_name: string
}

export interface Expense extends FinancialEntry, SubscriptionDetails {
  paid_on: string
}

export interface Charge extends FinancialEntry, SubscriptionDetails, PersonDetails {
  issued_on: string
  due_on: string | null
  agreement_id: number | null
  charge_batch_id: number | null
  paid_cents: number
  pending_cents: number
}

export interface Payment extends FinancialEntry, SubscriptionDetails, PersonDetails {
  charge_id: number
  received_on: string
}

export interface IssuedAgreement {
  agreement_id: number
  issued_on: string
  charges: Charge[]
}

export interface MonthlyCash {
  month: string
  expenses_cents: number
  income_cents: number
  net_cents: number
}

export interface Dashboard {
  from: string
  to: string
  expenses_cents: number
  income_cents: number
  net_cents: number
  charged_cents: number
  charge_margin_cents: number
  pending_cents: number
  monthly: MonthlyCash[]
}
