import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './button'

export const Dialog = DialogPrimitive.Root
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export function DialogContent({ children, busy, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { busy?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-dialog-overlay" />
      <DialogPrimitive.Content className="ui-dialog-content" {...props}>
        <DialogPrimitive.Close asChild>
          <Button className="ui-dialog-close" variant="ghost" size="icon" aria-label="Cerrar formulario" disabled={busy}>
            <X size={19} aria-hidden="true" />
          </Button>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
