import React from 'react'
import { cn } from '../../lib/utils'

type DialogProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div
        className={cn(
          'relative z-10 w-full max-w-2xl rounded-md border bg-card p-4 shadow-lg',
          className
        )}
      >
        {title && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
