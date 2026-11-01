import { useEffect, useState } from 'react'
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react'
import {
  ChevronDownIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  ClipboardDocumentListIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import { withBasePath } from '@/utils/basePath'
import { clearEvaluationSettings } from '@/features/quizEvaluation/client'

type AuthUser = {
  id: string
  username: string
  role: string
}

export const AuthStatus = ({ modern = false }: { modern?: boolean }) => {
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    void fetch(withBasePath('/api/auth/me/'))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setUser(data?.user || null))
      .catch(() => setUser(null))
  }, [])

  if (!user) return null

  const logout = async () => {
    clearEvaluationSettings()
    await fetch(withBasePath('/api/auth/logout/'), {
      method: 'POST',
      credentials: 'include',
    })
    window.location.assign(withBasePath('/'))
  }

  const openLessonPortal = () => {
    window.location.assign(withBasePath('/'))
  }

  if (modern) {
    return (
      <nav className="chat-navigation" aria-label="アカウントと管理">
        <Menu as="div" className="chat-account-menu">
          <MenuButton
            className="chat-account-trigger"
            aria-label={`${user.username} のアカウントメニュー`}
          >
            <span className="chat-user-initial" aria-hidden="true">
              {Array.from(user.username)[0]?.toUpperCase()}
            </span>
            <span className="chat-account-name">{user.username}</span>
            <ChevronDownIcon aria-hidden="true" />
          </MenuButton>
          <MenuItems className="chat-account-dropdown">
            <div className="chat-account-caption">{user.username}</div>
            <MenuItem>
              <button type="button" onClick={openLessonPortal}>
                <BookOpenIcon aria-hidden="true" />
                授業画面
              </button>
            </MenuItem>
            {user.role === 'admin' && (
              <>
                <MenuItem>
                  <a href={withBasePath('/admin/question-studio/')}>
                    <Squares2X2Icon aria-hidden="true" />
                    管理画面
                  </a>
                </MenuItem>
                <MenuItem>
                  <a href={withBasePath('/admin/activity-logs/')}>
                    <ClipboardDocumentListIcon aria-hidden="true" />
                    ログ確認
                  </a>
                </MenuItem>
              </>
            )}
            <MenuItem>
              <button type="button" onClick={logout}>
                <ArrowRightStartOnRectangleIcon aria-hidden="true" />
                ログアウト
              </button>
            </MenuItem>
          </MenuItems>
        </Menu>
      </nav>
    )
  }

  return (
    <div className="chat-account fixed left-auto top-auto bottom-3 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border border-[#C8D8EC] bg-white/92 px-3 py-2 text-xs font-bold text-[#526682] shadow-[0_10px_28px_rgba(36,48,59,0.12)] backdrop-blur md:bottom-4 md:right-4 md:max-w-none">
      <span className="max-w-20 truncate rounded-full bg-[#F7FAFF] px-2.5 py-1 text-[#526682]">
        {user.username}
      </span>
      <button
        type="button"
        onClick={openLessonPortal}
        className="rounded-full bg-[#EEF4FF] px-3 py-1 text-[#245DCC] transition-colors hover:bg-[#DFEAFF]"
      >
        授業画面
      </button>
      {user.role === 'admin' && (
        <>
          <a
            href={withBasePath('/admin/question-studio/')}
            className="rounded-full bg-[#FFF4DF] px-3 py-1 text-[#AA731D] transition-colors hover:bg-[#FFE8BE]"
          >
            管理画面
          </a>
          <a
            href={withBasePath('/admin/activity-logs/')}
            className="rounded-full bg-[#EDF8F1] px-3 py-1 text-[#1D7041] transition-colors hover:bg-[#DDF2E5]"
          >
            ログ確認
          </a>
        </>
      )}
      <button
        type="button"
        onClick={logout}
        className="rounded-full bg-[#EEF4FF] px-3 py-1 text-[#245DCC] transition-colors hover:bg-[#DFEAFF]"
      >
        ログアウト
      </button>
    </div>
  )
}
