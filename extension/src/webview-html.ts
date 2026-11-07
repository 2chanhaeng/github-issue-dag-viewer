import { WEBVIEW_CONFIG_ELEMENT_ID, type WebviewConfig } from '../../src/platform/protocol'

export interface WebviewDocument {
  /** `webview.cspSource`: the origin VS Code serves local extension resources from. */
  cspSource: string
  nonce: string
  scriptUri: string
  stylesheetUri: string
  config: WebviewConfig
}

/**
 * Mirrors the hosted page's policy, with two differences: scripts need the per-document nonce,
 * and the webview never connects anywhere because the extension host performs GitHub requests.
 */
export const contentSecurityPolicy = (cspSource: string, nonce: string): string =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: https://avatars.githubusercontent.com https://github.com`,
    `font-src ${cspSource}`,
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}

export const escapeHtml = (value: string): string =>
  value.replace(/[&"'<>]/g, (character) => HTML_ESCAPES[character] ?? character)

/** JSON inside a `<script>` data block must not be able to close the element or start a comment. */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

export const renderWebviewHtml = ({
  cspSource,
  nonce,
  scriptUri,
  stylesheetUri,
  config,
}: WebviewDocument): string => `<!doctype html>
<html lang="en" data-color-mode="${escapeHtml(config.colorMode)}" data-light-theme="light" data-dark-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(cspSource, nonce))}" />
    <title>Issue Atlas</title>
    <link rel="stylesheet" href="${escapeHtml(stylesheetUri)}" />
    <script type="application/json" id="${WEBVIEW_CONFIG_ELEMENT_ID}">${scriptJson(config)}</script>
    <script type="module" nonce="${escapeHtml(nonce)}" src="${escapeHtml(scriptUri)}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
