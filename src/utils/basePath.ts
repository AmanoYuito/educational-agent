import getConfig from 'next/config'

type RuntimeConfig = {
  root?: string
  basePath?: string
}

const getRuntimeConfig = (): RuntimeConfig => {
  const { publicRuntimeConfig } = getConfig() || {}
  return publicRuntimeConfig || {}
}

const prependPath = (prefix: string, path: string) => {
  if (!path.startsWith('/')) return path
  const normalizedPrefix = prefix.replace(/\/+$/, '')
  return normalizedPrefix ? `${normalizedPrefix}${path}` : path
}

export const withBasePath = (path: string) =>
  prependPath(getRuntimeConfig().root || '', path)

/**
 * API requests must use Next.js' basePath, not assetPrefix/PUBLIC_PATH.
 * PUBLIC_PATH may be an asset URL and is not guaranteed to route API calls.
 */
export const withApiBasePath = (path: string) => {
  const { basePath, root } = getRuntimeConfig()
  const localRoot = root?.startsWith('/') ? root : ''
  return prependPath(basePath || localRoot || '', path)
}
