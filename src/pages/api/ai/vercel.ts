// import { NextRequest } from 'next/server'

// export const config = {
//   runtime: 'edge',
// }

// export default async function handler(req: NextRequest) {
//   if (req.method !== 'POST') {
//     return new Response('Method Not Allowed', { status: 405 })
//   }

//   const stream = new ReadableStream({
//     async start(controller) {
//       try {
//         const { messages } = await req.json()
//         const userMessage = messages?.[messages.length - 1]?.content ?? ''

//         const difyResponse = await fetch(
//           'https://api.dify.ai/v1/chat-messages',
//           {
//             method: 'POST',
//             headers: {
//               'Content-Type': 'application/json',
//               Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
//             },
//             body: JSON.stringify({
//               inputs: {},
//               query: userMessage,
//               response_mode: 'blocking',
//               user: 'user-001',
//             }),
//           }
//         )

//         const data = await difyResponse.json()

//         console.log('=== DIFY RAW RESPONSE ===')
//         console.log(JSON.stringify(data, null, 2))
//         console.log('=========================')

//         const answer = data?.answer ?? '（Difyから応答がありません）'

//         // ★ OpenAI互換 SSE（これが本命）
//         controller.enqueue(
//           `data: ${JSON.stringify({
//             choices: [
//               {
//                 delta: { content: answer },
//               },
//             ],
//           })}\n\n`
//         )

//         controller.enqueue(`data: [DONE]\n\n`)
//       } catch (e) {
//         controller.enqueue(
//           `data: ${JSON.stringify({
//             choices: [
//               {
//                 delta: { content: 'エラーが発生しました' },
//               },
//             ],
//           })}\n\n`
//         )
//         controller.enqueue(`data: [DONE]\n\n`)
//       } finally {
//         controller.close()
//       }
//     },
//   })

//   return new Response(stream, {
//     headers: {
//       'Content-Type': 'text/event-stream; charset=utf-8',
//       'Cache-Control': 'no-cache',
//       Connection: 'keep-alive',
//     },
//   })
// }

// /src/pages/api/ai/vercel.ts
import { NextRequest } from 'next/server'

export const config = {
  runtime: 'edge',
}

/**
 * Edge runtime でも「同一インスタンスが生きている間」は保持される。
 * ただしコールドスタート/再デプロイで消えるので、まず動かす用途として。
 */
const conversationByUser = new Map<string, string>()

function getUserId(req: NextRequest) {
  // AITuber-kit側で固定IDを渡せるなら、ここで拾うのがベスト
  // 例: fetch時に header 'x-user-id' を付ける
  const fromHeader =
    req.headers.get('x-user-id') ||
    req.headers.get('x-forwarded-for') || // ある場合だけ
    ''

  // 環境によっては空になるので最低限のフォールバック
  return fromHeader || 'user-001'
}

function extractTopLevelJsonObjects(text: string): Record<string, any>[] {
  const s = String(text || '')
  const results: Record<string, any>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth -= 1
      if (depth === 0 && start >= 0) {
        const chunk = s.slice(start, i + 1)
        try {
          const obj = JSON.parse(chunk)
          if (obj && typeof obj === 'object') {
            results.push(obj)
          }
        } catch {
          // ignore parse errors and continue scanning
        }
        start = -1
      }
    }
  }
  return results
}

function normalizeDifyAnswer(raw: unknown): string {
  const answer = String(raw ?? '')
  const objects = extractTopLevelJsonObjects(answer).filter(
    (obj) => typeof obj.type === 'string'
  )
  console.log(
    `[vercel] parsed typed objects: ${objects.length}`,
    objects.map((o: any) => o.type).join(',')
  )
  if (objects.length <= 1) return answer
  // Split concatenated JSON objects for stable downstream parsing.
  const normalized = objects.map((obj) => JSON.stringify(obj)).join('\n')
  console.log('[vercel] normalized answer preview:', normalized.slice(0, 240))
  return normalized
}

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { messages } = await req.json()
        const userMessage: string =
          messages?.[messages.length - 1]?.content ?? ''

        const userId = getUserId(req)

        // 「リセット」って打ったら会話IDを捨てる（任意）
        // Dify側のstateが壊れた時の復帰に便利
        const normalized = userMessage.trim().toLowerCase()
        if (normalized === 'reset' || normalized === 'リセット') {
          conversationByUser.delete(userId)
        }

        const conversation_id = conversationByUser.get(userId)

        const difyResponse = await fetch(
          'https://api.dify.ai/v1/chat-messages',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
            },
            body: JSON.stringify({
              inputs: {},
              query: userMessage,
              response_mode: 'blocking',
              user: userId,
              // ★ここが重要：conversation_id を渡すことで「前回の続き」になる
              ...(conversation_id ? { conversation_id } : {}),
            }),
          }
        )

        const data = await difyResponse.json()

        console.log('=== DIFY RAW RESPONSE ===')
        console.log(JSON.stringify(data, null, 2))
        console.log('=========================')

        if (!difyResponse.ok) {
          const errorMessage = `Dify error (${data?.code || difyResponse.status}): ${data?.message || 'unknown error'}`
          controller.enqueue(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: { content: errorMessage },
                },
              ],
            })}\n\n`
          )
          controller.enqueue(`data: [DONE]\n\n`)
          return
        }

        // ★返ってきた会話IDを保存（次回以降に渡す）
        if (data?.conversation_id) {
          conversationByUser.set(userId, data.conversation_id)
        }

        const answer = normalizeDifyAnswer(
          data?.answer ?? '（Difyから応答がありません）'
        )
        const normalizedAnswer = String(answer ?? '').trim()

        // OpenAI互換 SSE で返す（AITuber-kit向け）
        if (normalizedAnswer.length > 0) {
          controller.enqueue(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: { content: answer },
                },
              ],
            })}\n\n`
          )
        } else {
          console.log('[vercel] skip empty answer payload')
        }
        controller.enqueue(`data: [DONE]\n\n`)
      } catch (e) {
        console.error(e)
        controller.enqueue(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: { content: 'エラーが発生しました' },
              },
            ],
          })}\n\n`
        )
        controller.enqueue(`data: [DONE]\n\n`)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
