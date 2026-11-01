import crypto from 'crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

import { enabledLessons } from '@/config/lessons'
import type { LearningActivitySummary } from '@/features/stores/home'
import { requireSession } from '@/lib/server/auth'
import {
  ensureLearningLogSchema,
  getPool,
  isDatabaseConfigured,
} from '@/lib/server/db'

const eventTypes = new Set([
  'page_enter',
  'workspace_view',
  'active_time',
  'material_page_view',
  'material_scroll',
  'material_open_external',
])

type ActivityInput = {
  id?: unknown
  lessonId?: unknown
  eventType?: unknown
  viewMode?: unknown
  durationMs?: unknown
  pageNumber?: unknown
  pageCount?: unknown
  metadata?: unknown
}

const text = (value: unknown, maximum = 120) =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : ''

const integer = (value: unknown, minimum: number, maximum: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

const detectClient = (userAgent: string) => {
  const deviceType = /iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)
    ? 'tablet'
    : /Mobi|iPhone|iPod/i.test(userAgent)
      ? 'smartphone'
      : 'pc'
  const osName = /Windows/i.test(userAgent)
    ? 'Windows'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /iPad/i.test(userAgent)
        ? 'iPadOS'
        : /iPhone|iPod/i.test(userAgent)
          ? 'iOS'
          : /Mac OS X|Macintosh/i.test(userAgent)
            ? 'macOS'
            : /CrOS/i.test(userAgent)
              ? 'Chrome OS'
              : /Linux/i.test(userAgent)
                ? 'Linux'
                : '不明'
  const browserName = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /SamsungBrowser/i.test(userAgent)
      ? 'Samsung Internet'
      : /Firefox\//i.test(userAgent)
        ? 'Firefox'
        : /Chrome\//i.test(userAgent)
          ? 'Chrome'
          : /Safari\//i.test(userAgent)
            ? 'Safari'
            : '不明'
  return { deviceType, osName, browserName }
}

const anonymizedIp = (req: NextApiRequest) => {
  const forwarded = req.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]?.trim() ||
      text(req.headers['x-real-ip']) ||
      req.socket.remoteAddress ||
      ''
  if (!raw) return ''
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) return ''
  return crypto
    .createHmac('sha256', secret)
    .update(raw)
    .digest('hex')
    .slice(0, 24)
}

const safeMetadata = (value: unknown, req: NextApiRequest) => {
  const supplied =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const cleaned: Record<string, string | number | boolean | null> = {}
  Object.entries(supplied)
    .slice(0, 20)
    .forEach(([key, item]) => {
      if (!/^[a-zA-Z0-9_]{1,50}$/.test(key)) return
      if (
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean' ||
        item === null
      ) {
        cleaned[key] = typeof item === 'string' ? item.slice(0, 300) : item
      }
    })
  cleaned.clientPlatform = text(req.headers['sec-ch-ua-platform'], 100)
  cleaned.clientMobile = text(req.headers['sec-ch-ua-mobile'], 20)
  return cleaned
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = requireSession(req, res)
  if (!session) return
  if (!isDatabaseConfigured())
    return res.status(503).json({ message: 'DATABASE_URL is not set' })

  if (req.method === 'GET') {
    const lessonId = text(req.query.lessonId)
    if (!enabledLessons.some((lesson) => lesson.id === lessonId))
      return res.status(400).json({ message: '授業回を確認してください。' })
    try {
      await ensureLearningLogSchema()
      const result = await getPool().query<{
        total_active_ms: string
        material_active_ms: string
        avatar_active_ms: string
        quiz_active_ms: string
        conversation_active_ms: string
        last_material_page: number | null
      }>(
        `SELECT
          COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'active_time'), 0)::text AS total_active_ms,
          COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'active_time' AND view_mode = 'material'), 0)::text AS material_active_ms,
          COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'active_time' AND view_mode = 'avatar'), 0)::text AS avatar_active_ms,
          COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'active_time' AND metadata->>'isProblemMode' = 'true'), 0)::text AS quiz_active_ms,
          COALESCE(SUM(duration_ms) FILTER (WHERE event_type = 'active_time' AND metadata->>'isProblemMode' = 'false'), 0)::text AS conversation_active_ms,
          (SELECT page_number FROM learning_activity_events recent
           WHERE recent.user_id = $1 AND recent.lesson_id = $2 AND recent.page_number IS NOT NULL
           ORDER BY recent.created_at DESC LIMIT 1) AS last_material_page
        FROM learning_activity_events
        WHERE user_id = $1 AND lesson_id = $2`,
        [session.userId, lessonId]
      )
      const row = result.rows[0]
      const summary: LearningActivitySummary = {
        totalActiveMs: Number(row?.total_active_ms || 0),
        materialActiveMs: Number(row?.material_active_ms || 0),
        avatarActiveMs: Number(row?.avatar_active_ms || 0),
        quizActiveMs: Number(row?.quiz_active_ms || 0),
        conversationActiveMs: Number(row?.conversation_active_ms || 0),
        lastMaterialPage: row?.last_material_page ?? null,
      }
      return res.status(200).json({ summary })
    } catch (error) {
      console.error('Failed to load learning activity:', error)
      return res
        .status(500)
        .json({ message: '学習時間を取得できませんでした。' })
    }
  }

  if (req.method === 'POST') {
    const events = Array.isArray(req.body?.events) ? req.body.events : []
    if (!events.length || events.length > 25)
      return res.status(400).json({ message: '活動ログを確認してください。' })
    const userAgent = text(req.headers['user-agent'], 1000)
    const client = detectClient(userAgent)
    const ipHash = anonymizedIp(req)
    try {
      await ensureLearningLogSchema()
      await Promise.all(
        events.map(async (raw: ActivityInput) => {
          const id = text(raw.id, 100)
          const lessonId = text(raw.lessonId)
          const eventType = text(raw.eventType, 50)
          if (
            !id ||
            !enabledLessons.some((lesson) => lesson.id === lessonId) ||
            !eventTypes.has(eventType)
          )
            throw new Error('invalid activity')
          const viewMode = ['material', 'avatar'].includes(text(raw.viewMode))
            ? text(raw.viewMode)
            : null
          const durationMs = integer(raw.durationMs, 0, 120000) ?? 0
          const pageNumber = integer(raw.pageNumber, 1, 10000)
          const pageCount = integer(raw.pageCount, 1, 10000)
          const metadata = safeMetadata(raw.metadata, req)
          await getPool().query(
            `INSERT INTO learning_activity_events
              (id, user_id, lesson_id, event_type, view_mode, duration_ms,
               page_number, page_count, device_type, os_name, browser_name,
               user_agent, ip_hash, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
             ON CONFLICT (id) DO NOTHING`,
            [
              id,
              session.userId,
              lessonId,
              eventType,
              viewMode,
              durationMs,
              pageNumber,
              pageCount,
              client.deviceType,
              client.osName,
              client.browserName,
              userAgent,
              ipHash,
              JSON.stringify(metadata),
            ]
          )
        })
      )
      return res.status(200).json({ savedCount: events.length })
    } catch (error) {
      console.error('Failed to save learning activity:', error)
      return res
        .status(400)
        .json({ message: '活動ログを保存できませんでした。' })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ message: 'Method not allowed' })
}
