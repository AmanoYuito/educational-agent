import crypto from 'crypto'

type QuestionPoolRequestClaims = {
  userId: string
  datasetId: string
  expiresAt: number
}

const getSecret = () => {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return secret
}

const encode = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url')

const decode = (value: string) => Buffer.from(value, 'base64url').toString()

const sign = (payload: string) =>
  encode(crypto.createHmac('sha256', getSecret()).update(payload).digest())

export const createQuestionPoolRequestToken = (
  userId: string,
  datasetId: string,
  lifetimeSeconds = 5 * 60
) => {
  const payload = encode(
    JSON.stringify({
      userId,
      datasetId,
      expiresAt: Math.floor(Date.now() / 1000) + lifetimeSeconds,
    } satisfies QuestionPoolRequestClaims)
  )
  return `${payload}.${sign(payload)}`
}

export const verifyQuestionPoolRequestToken = (
  token: string
): QuestionPoolRequestClaims | null => {
  try {
    const [payload, signature] = String(token || '').split('.')
    if (!payload || !signature) return null
    const expected = sign(payload)
    const actualBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    )
      return null

    const claims = JSON.parse(decode(payload)) as QuestionPoolRequestClaims
    if (
      !claims.userId ||
      !claims.datasetId ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt < Math.floor(Date.now() / 1000)
    )
      return null
    return claims
  } catch {
    return null
  }
}
