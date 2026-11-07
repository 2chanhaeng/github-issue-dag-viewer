import { useSyncExternalStore } from 'react'

export type ColorMode = 'light' | 'dark'

/** An external color-mode signal, such as the operating system or the VS Code theme. */
export interface ColorModeSource {
  /** True when Primer can resolve the mode itself from `prefers-color-scheme`. */
  followsSystem: boolean
  current: () => ColorMode
  subscribe: (onChange: () => void) => () => void
}

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export const systemColorModes: ColorModeSource = {
  followsSystem: true,
  current: () => (window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light'),
  subscribe: (onChange) => {
    const media = window.matchMedia(DARK_SCHEME_QUERY)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  },
}

export const useColorMode = (source: ColorModeSource): ColorMode =>
  useSyncExternalStore(source.subscribe, source.current)
