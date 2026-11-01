import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

import type { LessonDefinition } from '@/config/lessons'
import type { LearningActivityReporter } from '@/features/learningActivity/useLearningActivity'
import homeStore from '@/features/stores/home'
import { withBasePath } from '@/utils/basePath'

const MaterialPage = ({
  document,
  pageNumber,
  onVisibilityChange,
}: {
  document: any
  pageNumber: number
  onVisibilityChange: (pageNumber: number, ratio: number) => void
}) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(pageNumber <= 2)
  const [rendered, setRendered] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const observer = new ResizeObserver(() => setWidth(host.clientWidth))
    setWidth(host.clientWidth)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '900px 0px' }
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new IntersectionObserver(
      ([entry]) =>
        onVisibilityChange(
          pageNumber,
          entry.isIntersecting ? entry.intersectionRatio : 0
        ),
      { threshold: [0, 0.25, 0.5, 0.75] }
    )
    observer.observe(host)
    return () => {
      observer.disconnect()
      onVisibilityChange(pageNumber, 0)
    }
  }, [onVisibilityChange, pageNumber])

  useEffect(() => {
    if (!document || !visible || !width) return
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null =
      null

    const render = async () => {
      setRendered(false)
      setLoadError(false)
      try {
        const page = await document.getPage(pageNumber)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const scale = Math.max(0.1, (width - 32) / baseViewport.width)
        const viewport = page.getViewport({ scale })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return

        canvas.width = Math.floor(viewport.width * pixelRatio)
        canvas.height = Math.floor(viewport.height * pixelRatio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        const nextRenderTask = page.render({ canvasContext: context, viewport })
        renderTask = nextRenderTask
        await nextRenderTask.promise
        if (!cancelled) setRendered(true)
      } catch (error: any) {
        if (!cancelled && error?.name !== 'RenderingCancelledException') {
          console.error(
            `授業資料の${pageNumber}ページ目を表示できません:`,
            error
          )
          setLoadError(true)
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, visible, width])

  return (
    <div ref={hostRef} className="lesson-material-page">
      <span className="lesson-material-page-number">{pageNumber}</span>
      <canvas
        ref={canvasRef}
        aria-label={`${pageNumber}ページ目`}
        data-rendered={rendered || undefined}
      />
      {!rendered && !loadError ? (
        <div className="lesson-material-page-status">読み込み中…</div>
      ) : null}
      {loadError ? (
        <div className="lesson-material-page-status">表示できませんでした</div>
      ) : null}
    </div>
  )
}

export const LessonMaterialViewer = ({
  lesson,
  isProblemMode,
  onActivity,
  onOpenExternal,
}: {
  lesson: LessonDefinition
  isProblemMode: boolean
  onActivity: LearningActivityReporter
  onOpenExternal?: () => void
}) => {
  const materialUrl = withBasePath(lesson.materialPath)
  const [document, setDocument] = useState<any>(null)
  const [pageCount, setPageCount] = useState(lesson.materialPageCount || 0)
  const [loadError, setLoadError] = useState(false)
  const visiblePagesRef = useRef(new Map<number, number>())
  const activePageRef = useRef<number | null>(null)
  const lastScrollLogAtRef = useRef(0)

  const handlePageVisibility = useCallback(
    (pageNumber: number, ratio: number) => {
      if (ratio > 0) visiblePagesRef.current.set(pageNumber, ratio)
      else visiblePagesRef.current.delete(pageNumber)
      const nextPage = [...visiblePagesRef.current.entries()].sort(
        (left, right) => right[1] - left[1]
      )[0]?.[0]
      if (!nextPage || activePageRef.current === nextPage) return
      activePageRef.current = nextPage
      onActivity({
        eventType: 'material_page_view',
        viewMode: 'material',
        pageNumber: nextPage,
        pageCount,
        metadata: { consultedDuringQuiz: isProblemMode },
      })
      const current = homeStore.getState().learningActivitySummary
      if (current)
        homeStore.setState({
          learningActivitySummary: { ...current, lastMaterialPage: nextPage },
        })
    },
    [isProblemMode, onActivity, pageCount]
  )

  useEffect(() => {
    let cancelled = false
    let documentTask: { destroy: () => Promise<void> } | null = null

    const loadDocument = async () => {
      setLoadError(false)
      try {
        // Include PDF.js compatibility shims for older Safari versions.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = withBasePath(
          '/scripts/pdf.worker.min.mjs'
        )
        const loadingTask = pdfjs.getDocument(materialUrl)
        documentTask = loadingTask
        const loadedDocument = await loadingTask.promise
        if (cancelled) return
        setPageCount(loadedDocument.numPages)
        setDocument(loadedDocument)
      } catch (error) {
        if (!cancelled) {
          console.error('授業資料の表示に失敗しました:', error)
          setLoadError(true)
        }
      }
    }

    void loadDocument()
    return () => {
      cancelled = true
      setDocument(null)
      void documentTask?.destroy()
    }
  }, [materialUrl])

  return (
    <section
      className="lesson-material"
      aria-label={`${lesson.title}の授業資料`}
    >
      <div className="lesson-material-header">
        <div className="min-w-0">
          <p>授業資料</p>
          <h2>{lesson.materialLabel}</h2>
        </div>
        <div className="lesson-material-actions">
          <span className="lesson-material-page-count">
            全{pageCount}ページ
          </span>
          <a
            href={materialUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              onOpenExternal?.()
              onActivity({
                eventType: 'material_open_external',
                viewMode: 'material',
                pageNumber: activePageRef.current || undefined,
                pageCount,
                metadata: { consultedDuringQuiz: isProblemMode },
              })
            }}
          >
            別画面で開く
            <ArrowTopRightOnSquareIcon aria-hidden="true" />
          </a>
        </div>
      </div>
      <div
        className="lesson-material-frame"
        onScroll={(event) => {
          const now = Date.now()
          if (now - lastScrollLogAtRef.current < 1500) return
          lastScrollLogAtRef.current = now
          const element = event.currentTarget
          const maximum = Math.max(
            1,
            element.scrollHeight - element.clientHeight
          )
          onActivity({
            eventType: 'material_scroll',
            viewMode: 'material',
            pageNumber: activePageRef.current || undefined,
            pageCount,
            metadata: {
              consultedDuringQuiz: isProblemMode,
              scrollDepthPercent: Math.round(
                (element.scrollTop / maximum) * 100
              ),
            },
          })
        }}
      >
        {!document && !loadError ? (
          <div className="lesson-material-status">資料を読み込んでいます…</div>
        ) : null}
        {loadError ? (
          <div className="lesson-material-status lesson-material-error">
            <p>PDFを表示できませんでした。</p>
            <a
              href={materialUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOpenExternal?.()}
            >
              授業資料を別画面で開く
            </a>
          </div>
        ) : null}
        {document
          ? Array.from({ length: pageCount }, (_, index) => (
              <MaterialPage
                key={index + 1}
                document={document}
                pageNumber={index + 1}
                onVisibilityChange={handlePageVisibility}
              />
            ))
          : null}
      </div>
    </section>
  )
}
