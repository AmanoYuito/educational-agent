import crypto from 'crypto'
import { NextApiRequest, NextApiResponse } from 'next'

import { ensureSchema, isDatabaseConfigured, query } from '@/lib/server/db'
import { hashPassword, setSessionCookie } from '@/lib/server/auth'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { username, password } = req.body as {
    username?: string
    password?: string
  }

  const normalizedUsername = username?.trim()
  if (!normalizedUsername || !password) {
    return res
      .status(400)
      .json({ message: 'ユーザー名とパスワードが必要です。' })
  }

  if (!isDatabaseConfigured()) {
    return res.status(503).json({ message: 'DATABASE_URL が未設定です。' })
  }

  await ensureSchema()

  const id = crypto.randomUUID()

  try {
    const result = await query<{
      id: string
      username: string
      role: string
    }>(
      `
        INSERT INTO profiles (id, username, password_hash, role)
        VALUES ($1, $2, $3, 'student')
        RETURNING id, username, role
      `,
      [id, normalizedUsername, hashPassword(password)]
    )

    const user = result.rows[0]
    setSessionCookie(res, {
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    return res.status(201).json({ user })
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'このユーザー名は登録済みです。' })
    }
    console.error('Failed to register user:', error)
    return res.status(500).json({ message: 'ユーザー登録に失敗しました。' })
  }
}
