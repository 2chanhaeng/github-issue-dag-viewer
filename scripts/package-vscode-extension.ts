import { copyFile, readFile } from 'node:fs/promises'
import { createVSIX } from '@vscode/vsce'

const EXTENSION_DIRECTORY = 'extension'

const packageVersion = async (path: string): Promise<string> =>
  (JSON.parse(await readFile(path, 'utf8')) as { version: string }).version

const [applicationVersion, extensionVersion] = await Promise.all([
  packageVersion('package.json'),
  packageVersion(`${EXTENSION_DIRECTORY}/package.json`),
])
if (applicationVersion !== extensionVersion) {
  throw new Error(
    `extension/package.json version ${extensionVersion} must match package.json version ${applicationVersion}.`,
  )
}

await copyFile('LICENSE', `${EXTENSION_DIRECTORY}/LICENSE`)
await createVSIX({
  cwd: EXTENSION_DIRECTORY,
  dependencies: false,
  packagePath: `${EXTENSION_DIRECTORY}/issue-atlas-${extensionVersion}.vsix`,
})
