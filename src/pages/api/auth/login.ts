import { NextApiRequest, NextApiResponse } from 'next'

import { getPool, isDatabaseConfigured } from '@/lib/server/db'
import { setSessionCookie, verifyPassword } from '@/lib/server/auth'

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

  try {
    const result = await getPool().query<{
      id: string
      username: string
      password_hash: string
      role: string
    }>(
      `
        SELECT id, username, password_hash, role
        FROM profiles
        WHERE username = $1
        LIMIT 1
      `,
      [normalizedUsername]
    )

    const user = result.rows[0]
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res
        .status(401)
        .json({ message: 'ログイン情報が正しくありません。' })
    }

    setSessionCookie(res, {
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error: any) {
    console.error('Failed to login user:', error)

    if (error?.message === 'AUTH_SECRET is not set') {
      return res.status(500).json({
        message:
          'サーバー側の認証設定が不足しています。AUTH_SECRET を確認してください。',
      })
    }

    return res.status(500).json({
      message: 'ログイン処理に失敗しました。サーバーログを確認してください。',
    })
  }
}
