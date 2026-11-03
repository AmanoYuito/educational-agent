import type { LessonDefinition } from '@/config/lessons'

export type VisibleMaterialPage = { lessonId: string; pageNumber: number }
export type SlideFigureReference = VisibleMaterialPage

const FIGURE_WORDS =
  /(?:図(?:の|を|が|は|に|で|について|から)|表(?:の|を|が|は|に|で|について)|グラフ|画像|イラスト|模式図|フローチャート|矢印|このページ|このスライド)/u

export function resolveSlideFigureReference(
  question: string,
  lesson: LessonDefinition | undefined,
  visiblePage: VisibleMaterialPage | null
): SlideFigureReference | null {
  if (!lesson || !FIGURE_WORDS.test(question)) return null
  const namedLesson = question.match(/第\s*(\d{1,2})\s*回/u)
  if (namedLesson && Number(namedLesson[1]) !== lesson.lessonNumber) return null

  const explicitPage = question.match(
    /(?:スライド|ページ)\s*(\d{1,3})|\b(\d{1,3})\s*(?:枚目|ページ目?|スライド)/u
  )
  const pageNumber = explicitPage
    ? Number(explicitPage[1] || explicitPage[2])
    : visiblePage?.lessonId === lesson.id
      ? visiblePage.pageNumber
      : null

  if (
    !pageNumber ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > (lesson.materialPageCount || 0)
  )
    return null

  return { lessonId: lesson.id, pageNumber }
}
