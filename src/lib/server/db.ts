import { Pool, QueryResult, QueryResultRow } from 'pg'

import { enabledLessons } from '@/config/lessons'

let pool: Pool | null = null
let schemaReady: Promise<void> | null = null
let learningLogSchemaReady: Promise<void> | null = null

const getDatabaseUrl = () => process.env.DATABASE_URL || ''

export const isDatabaseConfigured = () => Boolean(getDatabaseUrl())

export const getPool = () => {
  if (!pool) {
    const connectionString = getDatabaseUrl()
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }

    pool = new Pool({
      connectionString,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
    })
  }

  return pool
}

/**
 * 学習ログ画面と学習行動の保存に必要な最小限のスキーマを整える。
 *
 * 通常の ensureSchema は問題プールなどアプリ全体の更新も担当するため、
 * 無関係なテーブルの更新に失敗するとログまで読めなくなる。ログ機能は
 * 予備調査の記録に使うため、独立した小さな更新処理も用意している。
 */
export const ensureLearningLogSchema = async () => {
  if (!isDatabaseConfigured()) return

  if (!learningLogSchemaReady) {
    learningLogSchemaReady = (async () => {
      const db = getPool()
      await db.query(
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )

      const quizColumns = [
        "lesson_id TEXT NOT NULL DEFAULT 'legacy'",
        "question_type TEXT NOT NULL DEFAULT 'multiple_choice'",
        'question_pool_id TEXT',
        'learning_session_id TEXT',
        'understand_skill TEXT',
        'difficulty_level INTEGER',
        'question_group TEXT',
        "answer_status TEXT NOT NULL DEFAULT 'incorrect'",
        'assessment_level TEXT',
        'score INTEGER',
        'response_time_ms INTEGER',
        'explanation TEXT',
        'correct_answer TEXT',
      ]
      for (const column of quizColumns) {
        await db.query(
          `ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS ${column}`
        )
      }
      await db.query(
        "UPDATE quiz_attempts SET answer_status = 'correct' WHERE is_correct = TRUE AND answer_status = 'incorrect'"
      )

      await db.query(`
        CREATE TABLE IF NOT EXISTS learning_feedbacks (
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL,
          checkpoint_answered INTEGER NOT NULL,
          feedback_text TEXT NOT NULL,
          evidence JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, lesson_id, checkpoint_answered)
        )
      `)
      await db.query(`
        CREATE TABLE IF NOT EXISTS learning_activity_events (
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
        )
      `)
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_feedbacks_user_lesson ON learning_feedbacks(user_id, lesson_id, checkpoint_answered DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_activity_user_lesson_created ON learning_activity_events(user_id, lesson_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_activity_lesson_event_created ON learning_activity_events(lesson_id, event_type, created_at DESC)'
      )
    })()
  }

  try {
    await learningLogSchemaReady
  } catch (error) {
    learningLogSchemaReady = null
    throw error
  }
}

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> => {
  await ensureSchema()
  return getPool().query<T>(text, params)
}

export const ensureSchema = async () => {
  if (!isDatabaseConfigured()) return

  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool()

      await db.query(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'student',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      await db.query(
        'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT'
      )
      await db.query(`
        UPDATE profiles
        SET username = COALESCE(NULLIF(username, ''), id)
        WHERE username IS NULL OR username = ''
      `)
      await db.query('ALTER TABLE profiles ALTER COLUMN username SET NOT NULL')
      await db.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username)'
      )

      await db.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL DEFAULT 'legacy',
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await db.query(
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )

      await db.query(`
        CREATE TABLE IF NOT EXISTS quiz_attempts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL DEFAULT 'legacy',
          question_pool_id TEXT,
          learning_session_id TEXT,
          understand_skill TEXT,
          question TEXT NOT NULL,
          question_type TEXT NOT NULL DEFAULT 'multiple_choice',
          choices JSONB,
          quiz_index INTEGER,
          total_questions INTEGER,
          difficulty_level INTEGER,
          question_group TEXT,
          correct_index INTEGER,
          correct_answer TEXT,
          user_answer TEXT NOT NULL,
          user_index INTEGER,
          is_correct BOOLEAN NOT NULL,
          answer_status TEXT NOT NULL DEFAULT 'incorrect',
          assessment_level TEXT,
          score INTEGER,
          response_time_ms INTEGER,
          explanation TEXT,
          ai_output TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await db.query(
        "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_pool_id TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS learning_session_id TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS understand_skill TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS difficulty_level INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_group TEXT'
      )
      await db.query(
        "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS answer_status TEXT NOT NULL DEFAULT 'incorrect'"
      )
      await db.query(
        "UPDATE quiz_attempts SET answer_status = 'correct' WHERE is_correct = TRUE AND answer_status = 'incorrect'"
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS assessment_level TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS score INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS response_time_ms INTEGER'
      )

      await db.query(`
        CREATE TABLE IF NOT EXISTS question_pool (
          id TEXT PRIMARY KEY,
          created_by_user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL DEFAULT 'legacy',
          topic TEXT,
          question_group TEXT NOT NULL,
          difficulty_level INTEGER NOT NULL DEFAULT 3,
          question_text TEXT NOT NULL,
          question_type TEXT NOT NULL DEFAULT 'multiple_choice',
          bloom_level TEXT,
          understand_skill TEXT,
          correct_answer TEXT NOT NULL,
          correct_index INTEGER,
          wrong_answers JSONB,
          choices JSONB,
          explanation TEXT,
          ai_output TEXT,
          source_context TEXT,
          question_number INTEGER,
          source_dataset_id TEXT,
          source_dataset_name TEXT,
          source_document_id TEXT,
          source_document_name TEXT,
          source_segment_ids JSONB,
          source_slide_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
          variant_family_id TEXT,
          variant_index INTEGER NOT NULL DEFAULT 0,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS question_number INTEGER'
      )
      await db.query(
        "ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_dataset_id TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_dataset_name TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_document_id TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_document_name TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_segment_ids JSONB'
      )
      await db.query(
        "ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS source_slide_numbers JSONB NOT NULL DEFAULT '[]'::jsonb"
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS bloom_level TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS understand_skill TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS variant_family_id TEXT'
      )
      await db.query(
        'ALTER TABLE question_pool ADD COLUMN IF NOT EXISTS variant_index INTEGER NOT NULL DEFAULT 0'
      )
      await db.query(
        `UPDATE question_pool
         SET bloom_level = 'remember'
         WHERE question_type = 'multiple_choice'
           AND bloom_level IS NULL`
      )
      for (const lesson of enabledLessons) {
        await db.query(
          `UPDATE question_pool
           SET lesson_id = $1
           WHERE source_dataset_id = $2
             AND lesson_id = 'legacy'`,
          [lesson.id, lesson.datasetId]
        )
      }

      await db.query(`
        CREATE TABLE IF NOT EXISTS user_learning_state (
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL DEFAULT 'legacy',
          latest_generated_quiz_memory JSONB,
          dify_conversation_id TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, lesson_id)
        )
      `)

      await db.query(`
        CREATE TABLE IF NOT EXISTS issued_quizzes (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          learning_session_id TEXT,
          quiz JSONB NOT NULL,
          graded_result JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      await db.query(`
        CREATE TABLE IF NOT EXISTS learning_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL,
          total_questions INTEGER NOT NULL DEFAULT 10,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      await db.query(`
        CREATE TABLE IF NOT EXISTS learning_feedbacks (
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          lesson_id TEXT NOT NULL,
          checkpoint_answered INTEGER NOT NULL,
          feedback_text TEXT NOT NULL,
          evidence JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, lesson_id, checkpoint_answered)
        )
      `)

      await db.query(`
        CREATE TABLE IF NOT EXISTS learning_activity_events (
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
        )
      `)

      await db.query(`
        CREATE TABLE IF NOT EXISTS quiz_evaluations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          record JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_evaluations_user_created ON quiz_evaluations(user_id, created_at DESC)'
      )
      await db.query(`
        UPDATE question_pool AS qp
        SET bloom_level = qe.record->'inputs'->>'bloom_level'
        FROM quiz_evaluations AS qe
        WHERE qp.question_type = 'written'
          AND qp.bloom_level IS NULL
          AND qp.id = 'evaluation-' || COALESCE(qe.record->>'id', '')
          AND qe.record->'inputs'->>'bloom_level' IN ('remember', 'understand')
      `)
      await db.query(`
        UPDATE question_pool
        SET bloom_level = CASE
          WHEN ai_output ~ '"bloomLevel"[[:space:]]*:[[:space:]]*"remember"'
            THEN 'remember'
          WHEN ai_output ~ '"bloomLevel"[[:space:]]*:[[:space:]]*"understand"'
            THEN 'understand'
          ELSE bloom_level
        END
        WHERE question_type = 'written'
          AND bloom_level IS NULL
      `)
      await db.query(`
        UPDATE question_pool
        SET bloom_level = 'understand'
        WHERE question_type = 'written'
          AND bloom_level IS DISTINCT FROM 'understand'
      `)
      await db.query(`
        UPDATE question_pool AS qp
        SET understand_skill = qe.record->'inputs'->>'understand_skill'
        FROM quiz_evaluations AS qe
        WHERE qp.question_type = 'written'
          AND qp.understand_skill IS NULL
          AND qp.id = 'evaluation-' || COALESCE(qe.record->>'id', '')
          AND qe.record->'inputs'->>'understand_skill' IN (
            'interpret', 'exemplify', 'classify', 'summarize',
            'infer', 'compare', 'explain'
          )
      `)
      await db.query(`
        UPDATE question_pool
        SET understand_skill = CASE
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"interpret"' THEN 'interpret'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"exemplify"' THEN 'exemplify'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"classify"' THEN 'classify'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"summarize"' THEN 'summarize'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"infer"' THEN 'infer'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"compare"' THEN 'compare'
          WHEN ai_output ~ '"understandSkill"[[:space:]]*:[[:space:]]*"explain"' THEN 'explain'
          ELSE understand_skill
        END
        WHERE question_type = 'written'
          AND understand_skill IS NULL
      `)

      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_pool_id TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS learning_session_id TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS understand_skill TEXT'
      )
      await db.query(
        'ALTER TABLE issued_quizzes ADD COLUMN IF NOT EXISTS learning_session_id TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS quiz_index INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS total_questions INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS difficulty_level INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS question_group TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS correct_index INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS user_index INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS ai_output TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS assessment_level TEXT'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS score INTEGER'
      )
      await db.query(
        'ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS response_time_ms INTEGER'
      )
      await db.query(
        "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )
      await db.query(
        "ALTER TABLE quiz_attempts ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )
      await db.query(
        "ALTER TABLE user_learning_state ADD COLUMN IF NOT EXISTS lesson_id TEXT NOT NULL DEFAULT 'legacy'"
      )
      await db.query(
        'ALTER TABLE user_learning_state DROP CONSTRAINT IF EXISTS user_learning_state_pkey'
      )
      await db.query(
        'ALTER TABLE user_learning_state ADD PRIMARY KEY (user_id, lesson_id)'
      )

      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON chat_messages(user_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_chat_messages_user_lesson_created ON chat_messages(user_id, lesson_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_created ON quiz_attempts(created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_lesson_created ON quiz_attempts(user_id, lesson_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_question_pool_user ON quiz_attempts(question_pool_id, user_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_learning_session ON quiz_attempts(learning_session_id, created_at)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_issued_quizzes_learning_session ON issued_quizzes(learning_session_id, created_at)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_sessions_user_lesson ON learning_sessions(user_id, lesson_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_feedbacks_user_lesson ON learning_feedbacks(user_id, lesson_id, checkpoint_answered DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_feedbacks_updated ON learning_feedbacks(updated_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_activity_user_lesson_created ON learning_activity_events(user_id, lesson_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_learning_activity_lesson_event_created ON learning_activity_events(lesson_id, event_type, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_question_pool_user_created ON question_pool(created_by_user_id, created_at DESC)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_question_pool_group_difficulty ON question_pool(created_by_user_id, question_group, difficulty_level)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_question_pool_lesson_type_active ON question_pool(lesson_id, question_type, is_active)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_question_pool_variant_family ON question_pool(variant_family_id, variant_index)'
      )
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_quiz_attempts_lesson_group ON quiz_attempts(lesson_id, question_group, created_at DESC)'
      )

      await db.query('ALTER TABLE profiles DROP COLUMN IF EXISTS email')
      await db.query('ALTER TABLE profiles DROP COLUMN IF EXISTS display_name')
      await db.query(
        'ALTER TABLE chat_messages DROP COLUMN IF EXISTS session_id'
      )
      await db.query('ALTER TABLE chat_messages DROP COLUMN IF EXISTS html')
      await db.query('ALTER TABLE chat_messages DROP COLUMN IF EXISTS is_html')
      await db.query('ALTER TABLE chat_messages DROP COLUMN IF EXISTS meta')
      await db.query('DROP TABLE IF EXISTS study_sessions')
    })()
  }

  try {
    await schemaReady
  } catch (error) {
    // 一時的なDB障害や途中のスキーマ不整合を、プロセス再起動まで
    // 永続化しない。次のリクエストで安全に再試行できるようにする。
    schemaReady = null
    throw error
  }
}
