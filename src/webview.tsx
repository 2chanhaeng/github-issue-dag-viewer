import type { VsCodeWebviewApi } from './platform/vscode'
import { readWebviewConfig, syncDocumentColorMode, vscodePlatform } from './platform/vscode'
import { renderViewer } from './render'

declare const acquireVsCodeApi: () => VsCodeWebviewApi

const platform = vscodePlatform(acquireVsCodeApi(), readWebviewConfig(document), window, document)
syncDocumentColorMode(platform.colorModes, document)
renderViewer(platform)
