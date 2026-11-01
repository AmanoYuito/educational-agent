import { Talk } from './messages'
import { withBasePath } from '@/utils/basePath'

export async function synthesizeVoiceAzureOpenAIApi(
  talk: Talk,
  apiKey: string,
  azureTTSEndpoint: string,
  voice: string,
  speed: number
): Promise<ArrayBuffer> {
  const response = await fetch(withBasePath('/api/azureOpenAITTS'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: talk.message,
      voice,
      speed,
      apiKey,
      azureTTSEndpoint,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to generate speech')
  }

  return await response.arrayBuffer()
}
