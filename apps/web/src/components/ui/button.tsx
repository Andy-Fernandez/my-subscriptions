import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

const buttonVariants = cva('ui-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-transparent font-[650] disabled:opacity-[.54] [&_svg]:shrink-0', {
  variants: {
    variant: {
      default: 'ui-button-primary',
      outline: 'ui-button-outline',
      ghost: 'ui-button-ghost',
      secondary: 'ui-button-secondary',
    },
    size: {
      default: 'ui-button-md',
      sm: 'ui-button-sm',
      icon: 'ui-button-icon',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export function Button({ className, variant, size, type = 'button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button type={type} data-slot="button" className={twMerge(clsx(buttonVariants({ variant, size }), className))} {...props} />
}
