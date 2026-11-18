import { z } from './zod'

const base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
export const encryptedSchema = z.object({
  iv: base64.length(16),
  ciphertext: base64.min(24).max(12000),
}).strict()
export const setupSchema = encryptedSchema.extend({ salt: base64.length(24).regex(/==$/), version: z.literal(1) }).strict()
export const secretWriteSchema = encryptedSchema.extend({ revision: z.number().int().nonnegative() }).strict()
export type Envelope = z.infer<typeof encryptedSchema>
export type VaultSettings = z.infer<typeof setupSchema>
export type SecretRecord = Envelope & { revision: number }
