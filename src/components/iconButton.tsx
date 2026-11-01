import type { KnownIconType } from '@charcoal-ui/icons'
import { ButtonHTMLAttributes } from 'react'
import Image from 'next/image'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  iconName: keyof KnownIconType | 'screen-share' | 'stop'
  isProcessing: boolean
  isProcessingIcon?: keyof KnownIconType
  label?: string
  iconColor?: string
  backgroundColor?: string
}

const InlineIcon = ({ name }: { name: string }) => {
  if (name === '24/Send') {
    return (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M5.2 4.6c-.8-.4-1.6.4-1.2 1.2l2.4 5.1c.1.2.3.4.6.5l5.1.6-5.1.6c-.3 0-.5.2-.6.5L4 18.2c-.4.8.4 1.6 1.2 1.2l14-6.6c.7-.3.7-1.3 0-1.6l-14-6.6Z" />
      </svg>
    )
  }

  if (name === '24/Add') {
    return (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
    )
  }

  if (name === '24/Dot') {
    return (
      <svg
        aria-hidden="true"
        className="h-6 w-6 animate-pulse"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <circle cx="12" cy="12" r="4" />
      </svg>
    )
  }

  return <pixiv-icon name={name} scale="1"></pixiv-icon>
}

export const IconButton = ({
  iconName,
  isProcessing,
  isProcessingIcon,
  label,
  iconColor,
  backgroundColor = 'bg-primary hover:bg-primary-hover active:bg-primary-press disabled:bg-primary-disabled',
  ...rest
}: Props) => {
  return (
    <button
      type={rest.type || 'button'}
      {...rest}
      className={`${backgroundColor} rounded-2xl text-sm p-2 text-center inline-flex items-center
        ${iconColor || 'text-theme'}
        cursor-pointer disabled:cursor-not-allowed
        ${rest.className}
      `}
    >
      {isProcessing ? (
        <InlineIcon name={String(isProcessingIcon || '24/Dot')} />
      ) : iconName === 'screen-share' ? (
        <Image
          src="/images/icons/screen-share.svg"
          alt="screen share"
          width={24}
          height={24}
        />
      ) : iconName === 'stop' ? (
        <Image src="/images/icons/stop.svg" alt="stop" width={24} height={24} />
      ) : (
        <InlineIcon name={String(iconName)} />
      )}
      {label && <div className="mx-2 font-bold">{label}</div>}
    </button>
  )
}
