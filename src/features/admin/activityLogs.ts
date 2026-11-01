export type ActivityLogType = 'chat' | 'quiz' | 'feedback' | 'activity'

export type ActivityLogUser = {
  id: string
  username: string
}

export type ActivityLogUsersResponse = {
  users: ActivityLogUser[]
}

export type ActivityLogItem = {
  id: string
  type: ActivityLogType
  userId: string
  username: string
  lessonId: string
  createdAt: string
  subtype: string
  content: string
  question: string
  userAnswer: string
  correctAnswer: string
  isCorrect: boolean | null
  answerStatus?: 'correct' | 'incorrect' | 'unanswered'
  assessmentLevel: string
  score: number | null
  responseTimeMs: number | null
  understandSkill: string
  difficultyLevel: number | null
  questionGroup: string
  checkpointAnswered: number | null
  feedbackText: string
  durationMs: number | null
  viewMode: string
  pageNumber: number | null
  pageCount: number | null
  deviceType: string
  osName: string
  browserName: string
  userAgent: string
  ipHash: string
  metadata: Record<string, unknown>
}

export type ActivityLogStats = {
  total: number
  chat: number
  quiz: number
  feedback: number
  quizCorrect: number
  quizPartial: number
  quizReview: number
  averageResponseMs: number | null
  multipleChoice: number
  multipleChoiceCorrect: number
  written: number
  writtenUnderstood: number
  writtenPartial: number
  writtenReview: number
  activity: number
  activeTimeMs: number
  materialTimeMs: number
  avatarTimeMs: number
  quizTimeMs: number
  conversationTimeMs: number
  materialPageViews: number
  materialConsultsDuringQuiz: number
}

export type ActivityDeviceStats = {
  deviceType: string
  osName: string
  browserName: string
  events: number
  activeTimeMs: number
}

export type ActivitySkillStats = {
  skill: string
  attempts: number
  understood: number
  partial: number
  review: number
  averageResponseMs: number | null
}

export type ActivityLogResponse = {
  items: ActivityLogItem[]
  users: ActivityLogUser[]
  stats: ActivityLogStats
  skills: ActivitySkillStats[]
  devices: ActivityDeviceStats[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}
