import { NextApiRequest, NextApiResponse } from 'next'

import { getSessionFromRequest } from '@/lib/server/auth'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const session = getSessionFromRequest(req)
  if (!session) {
    return res.status(401).json({ user: null })
  }

  return res.status(200).json({
    user: {
      id: session.userId,
      username: session.username,
      role: session.role,
    },
  })
}
