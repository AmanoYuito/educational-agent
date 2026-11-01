import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import styles from '@/styles/chatWorkspace.module.css'
import {
  clampWorkspaceChatPaneWidth,
  MOBILE_LAYOUT_MAX,
} from '@/utils/responsiveLayout'

type WorkspaceResizeHandleProps = {
  containerRef: RefObject<HTMLDivElement>
  workspaceView: 'material' | 'avatar'
  chatPaneWidth: number
  onChange: (width: number) => void
}

export const WorkspaceResizeHandle = ({
  containerRef,
  workspaceView,
  chatPaneWidth,
  onChange,
}: WorkspaceResizeHandleProps) => {
  const [isDragging, setIsDragging] = useState(false)
  const pointerIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return

      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      if (rect.width < MOBILE_LAYOUT_MAX) return

      const desiredWidth =
        workspaceView === 'material'
          ? rect.right - event.clientX
          : event.clientX - rect.left

      onChange(clampWorkspaceChatPaneWidth(rect.width, desiredWidth))
    }

    const stopDragging = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return
      pointerIdRef.current = null
      setIsDragging(false)
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [containerRef, isDragging, onChange, workspaceView])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || container.clientWidth < MOBILE_LAYOUT_MAX) return

    event.preventDefault()
    pointerIdRef.current = event.pointerId
    setIsDragging(true)
  }

  if (chatPaneWidth <= 0) return null

  const boundaryLeft =
    workspaceView === 'material'
      ? `calc(100% - ${chatPaneWidth}px)`
      : `${chatPaneWidth}px`

  return (
    <div
      aria-hidden="true"
      className={styles.workspaceResizeHandle}
      data-dragging={isDragging ? '' : undefined}
      onPointerDown={handlePointerDown}
      style={{ left: boundaryLeft }}
    />
  )
}
