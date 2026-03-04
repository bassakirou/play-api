import { useMemo, useState } from 'react'
import { cn } from '../../lib/utils'

type Option = {
  value: string
  label: string
}

type Props = {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  className?: string
  multiple?: boolean
}

export function MultiSelect({ options, value, onChange, placeholder, className, multiple = true }: Props) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (val: string) => {
    if (!multiple) {
      onChange(val ? [val] : [])
      return
    }
    const set = new Set(value)
    if (set.has(val)) set.delete(val)
    else set.add(val)
    onChange(Array.from(set))
  }

  return (
    <div className={cn('rounded-md border bg-background', className)}>
      <div className="border-b px-2 py-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || 'Rechercher...'}
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <div className="max-h-40 overflow-auto p-2 text-sm">
        {filtered.map((opt) => {
          const checked = value.includes(opt.value)
          return (
            <label key={opt.value} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(opt.value)}
                disabled={!multiple && checked}
              />
              <span>{opt.label}</span>
            </label>
          )
        })}
        {!filtered.length && <div className="text-xs text-muted-foreground">Aucun résultat</div>}
      </div>
    </div>
  )
}
