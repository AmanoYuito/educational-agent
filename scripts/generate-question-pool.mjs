import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Pool } from 'pg'

const DEFAULT_DIFY_URL = 'https://api.dify.ai/v1/chat-messages'

const loadDotenvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

const loadEnvFiles = () => {
  const cwd = process.cwd()
  loadDotenvFile(path.join(cwd, '.env.local'))
  loadDotenvFile(path.join(cwd, '.env'))
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const parsed = {}

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = args[i + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
      continue
    }
    parsed[key] = next
    i += 1
  }

  return parsed
}

const normalizeDifyUrl = (rawUrl) => {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return DEFAULT_DIFY_URL
  if (trimmed.endsWith('/chat-messages')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat-messages`
  return `${trimmed.replace(/\/+$/, '')}/chat-messages`
}

const toDifficultyLevel = (value, fallback = 3) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(6, Math.max(1, Math.round(value)))
  }

  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  if (/^\d+$/.test(raw)) {
    return Math.min(6, Math.max(1, Number(raw)))
  }
  if (raw === 'easy') return 1
  if (raw === 'normal' || raw === 'medium') return 3
  if (raw === 'hard') return 5
  return fallback
}

const tryParseJsonObject = (text) => {
  if (!text) return null
  const trimmed = String(text).trim()

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') return parsed
    if (typeof parsed === 'string') {
      const nested = JSON.parse(parsed)
      if (nested && typeof nested === 'object') return nested
    }
  } catch {}

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
  }

  return null
}

const parseQuestionFromText = (text) => {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  const questionMatch = normalized.match(
    /【問題】\s*([\s\S]*?)(?=【選択肢】|正解[:：]|解説[:：]|$)/
  )
  const choicesSectionMatch = normalized.match(
    /【選択肢】\s*([\s\S]*?)(?=正解[:：]|解説[:：]|$)/
  )
  const answerMatch = normalized.match(/正解[:：]\s*([^\n]+)/)
  const explanationMatch = normalized.match(/解説[:：]\s*([\s\S]+)$/)

  const choices = choicesSectionMatch?.[1]
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(?:[A-DＡ-Ｄ1-4][.)．、:]?\s*)?(.+)$/)
      return match?.[1]?.trim() || line
    })
    .filter(Boolean)

  const question = questionMatch?.[1]?.trim()
  const correctAnswer = answerMatch?.[1]?.trim()
  const explanation = explanationMatch?.[1]?.trim()

  if (!question || !choices?.length) {
    return null
  }

  return {
    question,
    choices,
    correctAnswer,
    explanation,
  }
}

const normalizeGeneratedItem = ({
  parsed,
  rawText,
  requestedDifficulty,
  requestedGroup,
  requestedTopic,
}) => {
  const fallbackParsed = parseQuestionFromText(rawText)
  const source = parsed && typeof parsed === 'object' ? parsed : {}

  const question =
    String(source.public?.question || source.question || fallbackParsed?.question || '').trim()
  const choicesRaw = source.public?.choices || source.choices || fallbackParsed?.choices
  const choices = Array.isArray(choicesRaw)
    ? choicesRaw.map((choice) => String(choice).trim()).filter(Boolean)
    : []
  const correctAnswerRaw = source.correctAnswer || source.answer || fallbackParsed?.correctAnswer
  const correctAnswer = String(correctAnswerRaw || '').trim()
  const correctIndexRaw =
    typeof source.correctIndex === 'number'
      ? source.correctIndex
      : typeof source.answerIndex === 'number'
        ? source.answerIndex
        : choices.findIndex((choice) => choice === correctAnswer)
  const correctIndex =
    Number.isInteger(correctIndexRaw) && correctIndexRaw >= 0
      ? correctIndexRaw
      : null
  const wrongAnswersRaw = source.wrongAnswers || source.distractors
  const wrongAnswers = Array.isArray(wrongAnswersRaw)
    ? wrongAnswersRaw.map((answer) => String(answer).trim()).filter(Boolean)
    : choices.filter((_, index) => index !== correctIndex)
  const explanation = String(
    source.explanation || fallbackParsed?.explanation || ''
  ).trim()
  const difficultyLevel = toDifficultyLevel(
    source.difficultyLevel || source.difficulty || source.level,
    requestedDifficulty
  )
  const questionGroup = String(
    source.questionGroup ||
      source.group ||
      source.category ||
      requestedGroup ||
      requestedTopic ||
      'general'
  ).trim()

  if (!question) {
    throw new Error('question is empty')
  }
  if (choices.length < 2) {
    throw new Error('choices are missing')
  }
  if (correctIndex === null || !choices[correctIndex]) {
    throw new Error('correct answer could not be resolved')
  }

  return {
    question,
    choices,
    correctAnswer: choices[correctIndex],
    correctIndex,
    wrongAnswers,
    explanation,
    difficultyLevel,
    questionGroup,
  }
}

const buildGenerationPrompt = ({
  topic,
  group,
  difficultyLevel,
  sourceContext,
  index,
  count,
}) => `
${topic ? `トピック: ${topic}` : 'トピック: 学習内容に沿って決めてください'}
${group ? `想定する問題グループ: ${group}` : '問題グループ: 似た弱点分析に使える短い分類名を付けてください'}
ブルーム段階: 1〜6 の整数で ${difficultyLevel}
${sourceContext ? `参考文脈:\n${sourceContext}` : ''}

日本語の4択問題を1問だけ作ってください。${count > 1 ? `これは ${index + 1}/${count} 問目です。` : ''}
必ず JSON オブジェクトだけを返してください。説明文やコードブロックは不要です。
形式:
{
  "question": "問題文",
  "choices": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
  "correctIndex": 0,
  "correctAnswer": "正答",
  "wrongAnswers": ["誤答1", "誤答2", "誤答3"],
  "explanation": "解説",
  "difficultyLevel": ${difficultyLevel},
  "questionGroup": "${group || topic || 'general'}"
}
`.trim()

const main = async () => {
  loadEnvFiles()
  const args = parseArgs()

  const username = String(args.username || '').trim()
  if (!username) {
    throw new Error('--username は必須です')
  }

  const count = Math.max(1, Number(args.count || 10))
  const topic = String(args.topic || '').trim()
  const group = String(args.group || '').trim()
  const difficultyLevel = toDifficultyLevel(args.difficulty, 3)
  const sourceContext = String(args['source-context'] || '').trim()
  const databaseUrl = process.env.DATABASE_URL || ''
  const difyKey =
    String(args['api-key'] || '').trim() ||
    process.env.DIFY_QUESTION_POOL_API_KEY ||
    ''
  const difyUrl = normalizeDifyUrl(
    String(args.url || '').trim() || process.env.DIFY_QUESTION_POOL_URL || ''
  )

  if (!databaseUrl) {
    throw new Error('DATABASE_URL が設定されていません')
  }
  if (!difyKey) {
    throw new Error('DIFY_QUESTION_POOL_API_KEY が設定されていません')
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS question_pool (
        id TEXT PRIMARY KEY,
        created_by_user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        topic TEXT,
        question_group TEXT NOT NULL,
        difficulty_level INTEGER NOT NULL DEFAULT 3,
        question_text TEXT NOT NULL,
        question_type TEXT NOT NULL DEFAULT 'multiple_choice',
        correct_answer TEXT NOT NULL,
        correct_index INTEGER,
        wrong_answers JSONB,
        choices JSONB,
        explanation TEXT,
        ai_output TEXT,
        source_context TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const userResult = await pool.query(
      `
        SELECT id
        FROM profiles
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    )

    const userId = userResult.rows[0]?.id
    if (!userId) {
      throw new Error(`username=${username} のユーザーが見つかりません`)
    }

    let successCount = 0

    for (let index = 0; index < count; index += 1) {
      const prompt = buildGenerationPrompt({
        topic,
        group,
        difficultyLevel,
        sourceContext,
        index,
        count,
      })

      const response = await fetch(difyUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${difyKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: {
            mode: 'generate_question',
            ...(topic ? { topic } : {}),
            difficulty: String(difficultyLevel),
            ...(group ? { question_group: group } : {}),
            ...(sourceContext ? { source_context: sourceContext } : {}),
          },
          query: prompt,
          response_mode: 'blocking',
          user: `question-pool-generator-${username}`,
        }),
      })

      if (!response.ok) {
        throw new Error(`Dify API error: ${response.status}。Difyの実行ログを確認してください。`)
      }

      const data = await response.json()
      const rawText = String(
        data?.answer || data?.text || data?.message || data?.content || ''
      ).trim()
      const parsed = tryParseJsonObject(rawText)
      const item = normalizeGeneratedItem({
        parsed,
        rawText,
        requestedDifficulty: difficultyLevel,
        requestedGroup: group,
        requestedTopic: topic,
      })

      await pool.query(
        `
          INSERT INTO question_pool (
            id,
            created_by_user_id,
            topic,
            question_group,
            difficulty_level,
            question_text,
            question_type,
            correct_answer,
            correct_index,
            wrong_answers,
            choices,
            explanation,
            ai_output,
            source_context,
            is_active,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, TRUE,
            now(), now()
          )
        `,
        [
          randomUUID(),
          userId,
          topic || null,
          item.questionGroup,
          item.difficultyLevel,
          item.question,
          'multiple_choice',
          item.correctAnswer,
          item.correctIndex,
          JSON.stringify(item.wrongAnswers),
          JSON.stringify(item.choices),
          item.explanation || null,
          JSON.stringify({
            raw: data,
            parsed: parsed || null,
          }),
          sourceContext || null,
        ]
      )

      successCount += 1
      console.log(
        `[${successCount}/${count}] saved: ${item.question.slice(0, 60)}`
      )
    }

    console.log(`完了: ${successCount} 問を question_pool に保存しました`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
