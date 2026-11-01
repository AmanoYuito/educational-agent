export type Question = {
  id: string
  text: string
  choices: [string, string, string, string] // A,B,C,D
  correct: 'A' | 'B' | 'C' | 'D'
  explanation?: string
}

export const QUESTIONS: Question[] = [
  {
    id: 'q1',
    text: 'Q1. 2 + 2 は？',
    choices: ['3', '4', '5', '22'],
    correct: 'B',
    explanation: '2+2=4 です。',
  },
]
