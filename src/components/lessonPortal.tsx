import { ArrowRightIcon, BookOpenIcon } from '@heroicons/react/24/outline'

import { AuthStatus } from '@/components/authStatus'
import { Meta } from '@/components/meta'
import type { LessonDefinition } from '@/config/lessons'
import styles from '@/styles/chatWorkspace.module.css'
import { withBasePath } from '@/utils/basePath'

export const LessonPortal = ({ lessons }: { lessons: LessonDefinition[] }) => (
  <div
    className={`${styles.workspace} min-h-[100svh] bg-[#f4f7fc] text-[#26324a]`}
    data-lesson-portal
  >
    <Meta />
    <header className="border-b border-[#dce4f1] bg-white">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 md:px-8">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#5b6f91]">
            LEARNING PORTAL
          </p>
          <h1 className="text-lg font-bold tracking-tight">授業回を選択</h1>
        </div>
        <AuthStatus modern />
      </div>
    </header>

    <main className="mx-auto max-w-[960px] px-5 py-10 md:px-8 md:py-14">
      <section className="mb-7">
        <h2 className="text-2xl font-bold tracking-[-0.025em] md:text-3xl">
          学習する授業回を選択
        </h2>
      </section>

      <div className="grid gap-4">
        {lessons.map((lesson) => (
          <a
            key={lesson.id}
            href={withBasePath(`/lessons/${lesson.id}/`)}
            className="group flex items-center gap-5 rounded-[20px] border border-[#cfdced] bg-white p-5 shadow-[0_8px_24px_rgba(46,67,105,0.07)] transition hover:-translate-y-0.5 hover:border-[#7da2dd] hover:shadow-[0_14px_32px_rgba(46,67,105,0.12)] focus:outline-none focus:ring-4 focus:ring-[#d9e7ff] md:p-6"
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e9f1ff] text-[#2454a6]">
              <BookOpenIcon className="h-6 w-6" aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#63718a]">
                {lesson.courseName}
              </p>
              <h3 className="mt-1 text-xl font-bold tracking-tight md:text-2xl">
                {lesson.lessonName}
              </h3>
            </div>

            <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-[#2454a6]">
              開く
              <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
            </span>
          </a>
        ))}
      </div>
    </main>
  </div>
)
