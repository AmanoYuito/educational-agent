export const sanitizeLearningFeedbackText = (value: string): string =>
  value
    .replace(/^\s*今回の\s*[「『"][^」』"]+[」』"]\s*では[、,]\s*/u, '')
    .trim()
