import { useRef, useState, useSyncExternalStore } from 'react'
import { Download } from 'lucide-react'
import { Button } from './components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog'
import { getInstallState, promptInstall, subscribeToInstallState } from './pwa'
import './install.css'

const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const android = /Android/.test(navigator.userAgent)

export default function InstallApp() {
  const installState = useSyncExternalStore(subscribeToInstallState, getInstallState)
  const [showHelp, setShowHelp] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  if (installState === 'installed' || (!installState && !appleMobile && !android && !showHelp)) return null

  async function install() {
    if (await promptInstall().catch(() => false)) return
    setShowHelp(true)
  }

  return (
    <>
      <Button
        ref={button}
        className="install-control"
        size="icon"
        variant="outline"
        title="Instalar app"
        aria-label="Instalar app"
        onClick={() => void install()}
      >
        <Download size={19} aria-hidden="true" />
      </Button>
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent closeLabel="Cerrar instrucciones" onCloseAutoFocus={(event) => {
          event.preventDefault()
          button.current?.focus()
        }}>
          <div className="ui-dialog-header">
            <DialogTitle className="ui-dialog-title">Instalar Suscripciones</DialogTitle>
            <DialogDescription className="ui-dialog-description">
              {appleMobile
                ? <>En Safari, toca <strong>Compartir → Añadir a pantalla de inicio</strong>. Activa <strong>Abrir como app web</strong> si aparece y toca <strong>Añadir</strong>.</>
                : <>En el menú del navegador, busca <strong>Instalar</strong> o <strong>Añadir a pantalla de inicio</strong> y confirma la instalación.</>}
            </DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
