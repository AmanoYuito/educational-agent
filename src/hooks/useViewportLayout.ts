import { useEffect, useMemo, useState } from 'react'

import {
  getLayoutStage,
  getRightRailWidth,
  type LayoutStage,
} from '@/utils/responsiveLayout'

export const useViewportLayout = (): {
  layoutStage: LayoutStage
  viewportWidth: number
  windowWidth: number
  rightRailWidth: number
} => {
  const [viewportWidth, setViewportWidth] = useState(0)
  const [windowWidth, setWindowWidth] = useState(0)

  useEffect(() => {
    const updateViewportWidth = () => {
      const visualViewportWidth = window.visualViewport?.width || 0
      const viewportWidth = Math.max(
        window.innerWidth,
        document.documentElement.clientWidth || 0,
        visualViewportWidth
      )
      setViewportWidth(Math.round(viewportWidth))
      setWindowWidth(window.outerWidth || window.innerWidth)
    }

    updateViewportWidth()
    window.addEventListener('resize', updateViewportWidth)
    window.addEventListener('orientationchange', updateViewportWidth)
    window.visualViewport?.addEventListener('resize', updateViewportWidth)
    const resizeObserver = new ResizeObserver(updateViewportWidth)
    resizeObserver.observe(document.documentElement)

    return () => {
      window.removeEventListener('resize', updateViewportWidth)
      window.removeEventListener('orientationchange', updateViewportWidth)
      window.visualViewport?.removeEventListener('resize', updateViewportWidth)
      resizeObserver.disconnect()
    }
  }, [])

  const layoutStage = useMemo(
    () => getLayoutStage(viewportWidth),
    [viewportWidth]
  )

  return {
    layoutStage,
    viewportWidth,
    windowWidth,
    rightRailWidth: getRightRailWidth(viewportWidth),
  }
}
