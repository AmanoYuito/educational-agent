import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Form } from '@/components/form'
import MessageReceiver from '@/components/messageReceiver'
import { Introduction } from '@/components/introduction'
import { Menu } from '@/components/menu'
import { Meta } from '@/components/meta'
import { AuthStatus } from '@/components/authStatus'
import ModalImage from '@/components/modalImage'
import Live2DViewer from '@/components/live2DViewer'
import { Toasts } from '@/components/toasts'
import { WebSocketManager } from '@/components/websocketManager'
import ImageOverlay from '@/components/ImageOverlay'
import homeStore from '@/features/stores/home'
import settingsStore from '@/features/stores/settings'
import '@/lib/i18n'
import { buildUrl } from '@/utils/buildUrl'
import { YoutubeManager } from '@/components/youtubeManager'
import toastStore from '@/features/stores/toast'

const NoEmotion = () => {
  const webcamStatus = homeStore((s) => s.webcamStatus)
  const captureStatus = homeStore((s) => s.captureStatus)
  const backgroundImageUrl = homeStore((s) => s.backgroundImageUrl)
  const useVideoAsBackground = settingsStore((s) => s.useVideoAsBackground)
  const bgUrl =
    (webcamStatus || captureStatus) && useVideoAsBackground
      ? ''
      : backgroundImageUrl === 'green' || backgroundImageUrl === 'white'
        ? ''
        : `url(${buildUrl(backgroundImageUrl)})`
  const messageReceiverEnabled = settingsStore((s) => s.messageReceiverEnabled)
  const { t } = useTranslation()
  const characterPreset1 = settingsStore((s) => s.characterPreset1)
  const characterPreset2 = settingsStore((s) => s.characterPreset2)
  const characterPreset3 = settingsStore((s) => s.characterPreset3)
  const characterPreset4 = settingsStore((s) => s.characterPreset4)
  const characterPreset5 = settingsStore((s) => s.characterPreset5)
  const characterPresets = useMemo(
    () => [
      { key: 'characterPreset1', value: characterPreset1 },
      { key: 'characterPreset2', value: characterPreset2 },
      { key: 'characterPreset3', value: characterPreset3 },
      { key: 'characterPreset4', value: characterPreset4 },
      { key: 'characterPreset5', value: characterPreset5 },
    ],
    [
      characterPreset1,
      characterPreset2,
      characterPreset3,
      characterPreset4,
      characterPreset5,
    ]
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).__disableLive2DEmotion = true
    return () => {
      ;(window as any).__disableLive2DEmotion = false
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const keyMap: { [key: string]: number } = {
          Digit1: 1,
          Digit2: 2,
          Digit3: 3,
          Digit4: 4,
          Digit5: 5,
        }

        const keyNumber = keyMap[event.code]

        if (keyNumber) {
          settingsStore.setState({
            systemPrompt: characterPresets[keyNumber - 1].value,
          })
          toastStore.getState().addToast({
            message: t('Toasts.PresetSwitching', {
              presetName: t(`Characterpreset${keyNumber}`),
            }),
            type: 'info',
            tag: `character-preset-switching`,
          })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [characterPresets, t])

  const backgroundStyle =
    (webcamStatus || captureStatus) && useVideoAsBackground
      ? {}
      : backgroundImageUrl === 'green'
        ? { backgroundColor: '#00FF00' }
        : backgroundImageUrl === 'white'
          ? { backgroundColor: '#FFFFFF' }
          : { backgroundImage: bgUrl }

  return (
    <div className="h-[100svh] bg-white bg-cover" style={backgroundStyle}>
      <Meta />
      <AuthStatus />
      <Introduction />
      <Live2DViewer />
      <Form />
      <Menu />
      <ModalImage />
      {messageReceiverEnabled && <MessageReceiver />}
      <Toasts />
      <WebSocketManager />
      <YoutubeManager />
      <ImageOverlay />
    </div>
  )
}

export default NoEmotion
