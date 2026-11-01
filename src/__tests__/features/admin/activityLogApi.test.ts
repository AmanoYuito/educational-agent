import {
  ACTIVITY_LOGS_API_PATH,
  buildActivityLogsApiPath,
} from '@/features/admin/activityLogApi'

describe('activity log API path', () => {
  it('keeps the trailing slash required by the production proxy', () => {
    expect(ACTIVITY_LOGS_API_PATH).toBe('/api/admin/activity-logs/')
    expect(buildActivityLogsApiPath()).toBe('/api/admin/activity-logs/')
  })

  it('appends filters after the trailing slash', () => {
    const params = new URLSearchParams({ page: '2', type: 'quiz' })

    expect(buildActivityLogsApiPath(params)).toBe(
      '/api/admin/activity-logs/?page=2&type=quiz'
    )
  })
})
