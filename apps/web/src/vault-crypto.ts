import type { Envelope } from '@gestor/shared/vault'

const utf8 = new TextEncoder()
export const verifierText = 'gestor-suscripciones/vault/v1'
export const accountContext = (id: number) => verifierText + '/account/' + id
export const randomBase64 = (count: number) => encode(crypto.getRandomValues(new Uint8Array(count)))
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export async function deriveKey(phrase: string, salt: string) {
  const material = await crypto.subtle.importKey('raw', utf8.encode(phrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: decode(salt), iterations: 600000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export async function encrypt(key: CryptoKey, text: string, context: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(context) }, key, utf8.encode(text))
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(result)) }
}

export async function decrypt(key: CryptoKey, data: Envelope, context: string) {
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(data.iv), additionalData: utf8.encode(context) }, key, decode(data.ciphertext))
  return new TextDecoder().decode(result)
}
