import { useEffect, useState } from 'react'

/**
 * useState that a reload of the page (`restore`) puts back where it was; a new tab
 * starts from `initial`. Kept in sessionStorage: this tab only.
 */
export function useKept<T>(key: string, initial: T, restore: boolean): [T, (v: T) => void] {
  const full = `deltaviz:${key}`
  const [value, setValue] = useState<T>(() => {
    if (!restore) return initial
    try {
      const saved = sessionStorage.getItem(full)
      return saved === null ? initial : (JSON.parse(saved) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      // undefined isn't JSON: kept as no entry, which restores `initial`.
      if (value === undefined) sessionStorage.removeItem(full)
      else sessionStorage.setItem(full, JSON.stringify(value))
    } catch {}
  }, [full, value])
  return [value, setValue]
}
