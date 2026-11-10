export function input(value: string | number | boolean | null, formula?: string) {
  if (formula !== undefined && formula !== '') return formula
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  return `'${value}`
}

