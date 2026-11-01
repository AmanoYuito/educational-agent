import crypto from 'crypto'
import { NextApiRequest, NextApiResponse } from 'next'
import { Message } from '@/features/messages/messages'
import { requireSession } from '@/lib/server/auth'
import { isDatabaseConfigured, query } from '@/lib/server/db'
import { getLessonById } from '@/config/lessons'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const { messages: newMessages, lessonId } = req.body as {
      messages: Message[]
      lessonId?: string
    }
    const currentTime = new Date().toISOString()
    const session = requireSession(req, res)
    if (!session) return

    if (!isDatabaseConfigured()) {
      return res.status(503).json({ message: 'DATABASE_URL is not set' })
    }

    if (!Array.isArray(newMessages) || newMessages.length === 0) {
      return res.status(400).json({ message: 'Invalid messages data' })
    }
    const lesson = getLessonById(lessonId)
    if (!lesson) {
      return res.status(400).json({ message: 'Invalid lesson' })
    }

    for (const msg of newMessages) {
      await query(
        `
          INSERT INTO chat_messages (
            id,
            user_id,
            lesson_id,
            role,
            content,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE
          SET
            lesson_id = EXCLUDED.lesson_id,
            role = EXCLUDED.role,
            content = EXCLUDED.content,
            created_at = EXCLUDED.created_at
        `,
        [
          msg.id || crypto.randomUUID(),
          session.userId,
          lesson.id,
          msg.role,
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content),
          msg.timestamp || currentTime,
        ]
      )
    }

    res.status(200).json({ message: 'Chat messages saved successfully' })
  } catch (error) {
    console.error('Error saving chat log:', error)
    res.status(500).json({ message: 'Error saving chat log' })
  }
}
