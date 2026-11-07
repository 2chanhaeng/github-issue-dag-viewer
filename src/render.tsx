import '@primer/primitives/dist/css/functional/themes/dark.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import type { ViewerPlatform } from './platform/types'

export const renderViewer = (platform: ViewerPlatform): void => {
  const root = document.getElementById('root')
  if (root === null) throw new Error('Application root was not found.')

  createRoot(root).render(
    <StrictMode>
      <App platform={platform} />
    </StrictMode>,
  )
}
