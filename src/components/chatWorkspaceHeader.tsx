import { AuthStatus } from './authStatus'
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentListIcon,
  Squares2X2Icon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import Link from 'next/link'

import type { LessonDefinition } from '@/config/lessons'
import type { StudyWorkspaceView } from '@/components/studyWorkspace'
import { withBasePath } from '@/utils/basePath'

export const ChatWorkspaceHeader = ({
  isProblemMode,
  lesson,
  workspaceView,
  onWorkspaceViewChange,
}: {
  isProblemMode: boolean
  lesson: LessonDefinition
  workspaceView: StudyWorkspaceView
  onWorkspaceViewChange: (view: StudyWorkspaceView) => void
}) => {
  const modeLabel = isProblemMode ? '問題モード' : '会話モード'
  const ModeIcon = isProblemMode
    ? ClipboardDocumentListIcon
    : ChatBubbleLeftRightIcon
  return (
    <header className="chat-appbar">
      <div className="chat-header-start">
        <Link
          href={withBasePath('/')}
          className="chat-lesson-list-link"
          aria-label="授業回選択へ戻る"
        >
          <Squares2X2Icon aria-hidden="true" />
          <span>授業回</span>
        </Link>
        <div className="chat-lesson-title">
          <span>{lesson.courseName}</span>
          <strong>{lesson.lessonName}</strong>
        </div>
        <span
          className="chat-current-mode"
          data-mode={isProblemMode ? 'quiz' : 'conversation'}
          role="status"
          aria-label={`現在のモード：${modeLabel}`}
        >
          <ModeIcon aria-hidden="true" />
          {modeLabel}
        </span>
      </div>
      <div className="chat-header-end">
        <div className="workspace-view-switch" aria-label="学習画面の表示切替">
          <button
            type="button"
            data-active={workspaceView === 'material' ? 'true' : undefined}
            aria-pressed={workspaceView === 'material'}
            onClick={() => onWorkspaceViewChange('material')}
          >
            <BookOpenIcon aria-hidden="true" />
            <span>授業資料</span>
          </button>
          <button
            type="button"
            data-active={workspaceView === 'avatar' ? 'true' : undefined}
            aria-pressed={workspaceView === 'avatar'}
            onClick={() => onWorkspaceViewChange('avatar')}
          >
            <UserCircleIcon aria-hidden="true" />
            <span>アバター</span>
          </button>
        </div>
        <AuthStatus modern />
      </div>
    </header>
  )
}
