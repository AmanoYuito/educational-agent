import crypto from 'crypto'
import { NextApiRequest, NextApiResponse } from 'next'

const COOKIE_NAME = 'aituber_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export type AuthSession = {
  userId: string
  username: string
  role: string
  exp: number
}

const getAuthSecret = () => {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set')
  }
  return secret
}

const base64UrlEncode = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

const sign = (payload: string) =>
  base64UrlEncode(
    crypto.createHmac('sha256', getAuthSecret()).update(payload).digest()
  )

const serializeCookie = (value: string, maxAge: number) => {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

const getCookieValue = (req: NextApiRequest, name: string) => {
  const cookieHeader = req.headers.cookie || ''
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim())
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`))
  return target ? decodeURIComponent(target.slice(name.length + 1)) : ''
}

export const hashPassword = (password: string) => {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto
    .pbkdf2Sync(password, salt, 210000, 32, 'sha256')
    .toString('hex')
  return `pbkdf2_sha256$210000$${salt}$${hash}`
}

export const verifyPassword = (password: string, passwordHash: string) => {
  const [algorithm, iterationsRaw, salt, expectedHash] = passwordHash.split('$')
  if (
    algorithm !== 'pbkdf2_sha256' ||
    !iterationsRaw ||
    !salt ||
    !expectedHash
  ) {
    return false
  }

  const iterations = Number(iterationsRaw)
  const actual = crypto
    .pbkdf2Sync(password, salt, iterations, 32, 'sha256')
    .toString('hex')
  if (actual.length !== expectedHash.length) return false

  return crypto.timingSafeEqual(
    Buffer.from(actual, 'hex'),
    Buffer.from(expectedHash, 'hex')
  )
}

export const setSessionCookie = (
  res: NextApiResponse,
  session: Omit<AuthSession, 'exp'>
) => {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
  const payload = base64UrlEncode(JSON.stringify({ ...session, exp }))
  const signature = sign(payload)
  res.setHeader(
    'Set-Cookie',
    serializeCookie(
      encodeURIComponent(`${payload}.${signature}`),
      SESSION_MAX_AGE_SECONDS
    )
  )
}

export const clearSessionCookie = (res: NextApiResponse) => {
  res.setHeader('Set-Cookie', serializeCookie('', 0))
}

export const getSessionFromRequest = (
  req: NextApiRequest
): AuthSession | null => {
  try {
    const raw = getCookieValue(req, COOKIE_NAME)
    if (!raw) return null

    const [payload, signature] = raw.split('.')
    if (!payload || !signature || sign(payload) !== signature) return null

    const session = JSON.parse(base64UrlDecode(payload)) as AuthSession
    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    return session
  } catch {
    return null
  }
}

export const requireSession = (req: NextApiRequest, res: NextApiResponse) => {
  const session = getSessionFromRequest(req)
  if (!session) {
    res.status(401).json({ message: 'Unauthorized' })
    return null
  }
  return session
}
