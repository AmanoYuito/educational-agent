#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { loadEnvConfig } = require('@next/env')
const { Pool } = require('pg')

loadEnvConfig(process.cwd())

const connectionString = process.env.DATABASE_URL || ''
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sourcePath = path.join(
  process.cwd(),
  'src/pages/api/admin/activity-logs.ts'
)
const source = fs.readFileSync(sourcePath, 'utf8')
const match = source.match(/const eventsCte = `([\s\S]*?)`\s*\n/)
if (!match) {
  console.error('管理画面のログ集計SQLを読み取れませんでした。')
  process.exit(1)
}

const eventsCte = match[1]
const pool = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
})

const main = async () => {
  const result = await pool.query(`${eventsCte}
    SELECT
      COUNT(*)::integer AS total_count,
      COUNT(*) FILTER (WHERE event_type = 'chat')::integer AS chat_count,
      COUNT(*) FILTER (WHERE event_type = 'quiz')::integer AS quiz_count,
      COUNT(*) FILTER (WHERE event_type = 'feedback')::integer AS feedback_count,
      COUNT(*) FILTER (WHERE event_type = 'activity')::integer AS activity_count,
      COALESCE(SUM(duration_ms) FILTER (
        WHERE event_type = 'activity' AND subtype = 'active_time'
      ), 0)::integer AS active_time_ms,
      ROUND(AVG(response_time_ms) FILTER (
        WHERE event_type = 'quiz'
      ))::integer AS average_response_ms
    FROM events
  `)

  const counts = result.rows[0]
  console.log('管理画面の学習ログ集計SQLは正常です。')
  console.log(
    `全ログ ${counts.total_count}件 / 会話 ${counts.chat_count}件 / 問題回答 ${counts.quiz_count}件 / フィードバック ${counts.feedback_count}件 / 学習行動 ${counts.activity_count}件`
  )
}

main()
  .catch((error) => {
    console.error('管理画面の学習ログ集計SQLに問題があります。')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
