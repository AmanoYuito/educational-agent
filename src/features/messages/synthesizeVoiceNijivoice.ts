import { Talk } from './messages'
import { withBasePath } from '@/utils/basePath'

export async function synthesizeVoiceNijivoiceApi(
  talk: Talk,
  apiKey: string,
  voiceActorId: string,
  speed: number,
  emotionalLevel: number,
  soundDuration: number
) {
  // === Nijivoice TTS 一時無効化 ===
  // 実験中はボイス生成を行わず、API呼び出し自体をスキップします。
  // 将来再有効化する場合は、この return を削除してください。
  return new ArrayBuffer(0)
  try {
    const res = await fetch(withBasePath('/api/tts-nijivoice'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script: talk.message,
        speed,
        voiceActorId,
        apiKey,
        emotionalLevel,
        soundDuration,
      }),
    })

    if (!res.ok) {
      throw new Error(
        `Nijivoice APIからの応答が異常です。ステータスコード: ${res.status}`
      )
    }

    return await res.arrayBuffer()
  } catch (error: any) {
    if (error?.message) {
      throw new Error(`Nijivoiceでエラーが発生しました: ${error.message}`)
    } else {
      throw new Error('Nijivoiceで不明なエラーが発生しました')
    }
  }
}
