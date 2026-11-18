type InstallPrompt = Event & { prompt(): Promise<unknown> }
type InstallState = InstallPrompt | 'installed' | null

const standalone = window.matchMedia('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone
const installChanges = new EventTarget()
let installState: InstallState = standalone ? 'installed' : null

function setInstallState(next: InstallState) {
  installState = next
  installChanges.dispatchEvent(new Event('change'))
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  if (installState !== 'installed') setInstallState(event as InstallPrompt)
})
window.addEventListener('appinstalled', () => setInstallState('installed'))

export function getInstallState() {
  return installState
}

export function subscribeToInstallState(listener: () => void) {
  installChanges.addEventListener('change', listener)
  return () => installChanges.removeEventListener('change', listener)
}

export async function promptInstall() {
  const event = installState
  if (!event || event === 'installed') return false
  setInstallState(null)
  await event.prompt()
  return true
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}
