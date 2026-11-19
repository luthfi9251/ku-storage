export type Theme = 'light' | 'dark'

const KEY = 'ku-storage:theme'

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function system(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  document.documentElement.style.colorScheme = t
}

/** Called once before the first render so there is no flash of the wrong theme. */
export function initTheme() {
  applyTheme(stored() ?? system())
}

export function setTheme(t: Theme) {
  applyTheme(t)
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* storage unavailable: keep for this tab only */
  }
}
