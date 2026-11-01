export const ACTIVITY_LOGS_API_PATH = '/api/admin/activity-logs/'

export const buildActivityLogsApiPath = (
  searchParams?: URLSearchParams
): string => {
  const query = searchParams?.toString() || ''
  return query ? `${ACTIVITY_LOGS_API_PATH}?${query}` : ACTIVITY_LOGS_API_PATH
}
