#!/usr/bin/env node

const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL || ''

if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
})

const statements = [
  "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'",

  "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'",
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_pool_id TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS learning_session_id TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS understand_skill TEXT',
  "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'multiple_choice'",
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS choices JSONB',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS quiz_index INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS total_questions INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS difficulty_level INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_group TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS correct_index INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS correct_answer TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS user_index INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS assessment_level TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS score INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS response_time_ms INTEGER',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS explanation TEXT',
  'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS ai_output TEXT',

  "ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'",
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS question_number INTEGER',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_dataset_id TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_dataset_name TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_document_id TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_document_name TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_segment_ids JSONB',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS bloom_level TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS understand_skill TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS variant_family_id TEXT',
  'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS variant_index INTEGER NOT NULL DEFAULT 0',

  "ALTER TABLE user_learning_state ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'",
  'ALTER TABLE user_learning_state DROP CONSTRAINT IF EXISTS user_learning_state_pkey',
  'ALTER TABLE user_learning_state ADD PRIMARY KEY (user_id, lesson_id)',

  `CREATE TABLE IF NOT EXISTS issued_quizzes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    learning_session_id TEXT,
    quiz JSONB NOT NULL,
    graded_result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  'ALTER TABLE issued_quizzes ADD COLUMN IF NOT EXISTS learning_session_id TEXT',

  `CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    total_questions INTEGER NOT NULL DEFAULT 10,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS learning_feedbacks (
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    checkpoint_answered INTEGER NOT NULL,
    feedback_text TEXT NOT NULL,
    evidence JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lesson_id, checkpoint_answered)
  )`,

  `CREATE TABLE IF NOT EXISTS learning_activity_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    view_mode TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    page_number INTEGER,
    page_count INTEGER,
    device_type TEXT,
    os_name TEXT,
    browser_name TEXT,
    user_agent TEXT,
    ip_hash TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS quiz_evaluations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,

  'CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages(user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_chat_messages_user_lesson_created ON chat_messages(user_id, lesson_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_created ON quiz_attempts(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_lesson_created ON quiz_attempts(user_id, lesson_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_question_pool_user ON quiz_attempts(question_pool_id, user_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_learning_session ON quiz_attempts(learning_session_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_issued_quizzes_learning_session ON issued_quizzes(learning_session_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_learning_sessions_user_lesson ON learning_sessions(user_id, lesson_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_learning_feedbacks_user_lesson ON learning_feedbacks(user_id, lesson_id, checkpoint_answered DESC)',
  'CREATE INDEX IF NOT EXISTS idx_learning_feedbacks_updated ON learning_feedbacks(updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_learning_activity_user_lesson_created ON learning_activity_events(user_id, lesson_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_learning_activity_lesson_event_created ON learning_activity_events(lesson_id, event_type, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_question_pool_lesson_type_active ON question_pool(lesson_id, question_type, is_active)',
  'CREATE INDEX IF NOT EXISTS idx_question_pool_variant_family ON question_pool(variant_family_id, variant_index)',
  'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lesson_group ON quiz_attempts(lesson_id, question_group, created_at DESC)',
]

const main = async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const statement of statements) {
      await client.query(statement)
    }

    const result = await client.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM chat_messages) AS chat_count,
        (SELECT COUNT(*)::integer FROM quiz_attempts) AS quiz_count,
        (SELECT COUNT(*)::integer FROM learning_feedbacks) AS feedback_count,
        (SELECT COUNT(*)::integer FROM learning_activity_events) AS activity_count
    `)
    await client.query('COMMIT')

    const counts = result.rows[0]
    console.log('学習ログ用DBを更新しました。既存データは削除していません。')
    console.log(
      `会話 ${counts.chat_count}件 / 問題回答 ${counts.quiz_count}件 / フィードバック ${counts.feedback_count}件 / 学習行動 ${counts.activity_count}件`
    )
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
