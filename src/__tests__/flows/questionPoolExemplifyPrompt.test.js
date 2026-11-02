/** @jest-environment node */
const fs = require('fs')
const yaml = require('js-yaml')

const flowPath = fs.readdirSync('.').find((name) => name.endsWith('1007.yml'))

if (!flowPath) throw new Error('問題プール生成フローが見つかりません。')

const flow = yaml.load(fs.readFileSync(flowPath, 'utf8'))
const nodes = flow.workflow.graph.nodes
const start = nodes.find((node) => node.data.type === 'start')

const prompt = (id) =>
  nodes
    .find((node) => node.id === id)
    .data.prompt_template.map((item) => item.text)
    .join('\n')

it('asks learners to create and justify a real-life example', () => {
  const questionPrompt = prompt('1791150000002')

  expect(questionPrompt).toContain('概念の条件を満たす身近な場面')
  expect(questionPrompt).toContain('学習者自身が考え')
  expect(questionPrompt).toContain('どの部分が概念に当てはまるかも答えさせる')
  expect(questionPrompt).toContain(
    '教材に書かれた例を暗記して答えさせるのではなく'
  )
  expect(questionPrompt).toContain('身近な場面を一つ考えると？')
  expect(questionPrompt).not.toContain(
    'exemplify（例示する）: 教材に明記された範囲で、概念に当てはまるものを挙げる。'
  )
})

it('treats the model answer as one valid example rather than the only answer', () => {
  const answerPrompt = prompt('1791150000003')

  expect(answerPrompt).toContain('正答例の1つとして作り')
  expect(answerPrompt).toContain('教材の条件を満たす別の具体例も正解')
  expect(answerPrompt).toContain('身近な例と、その例が当てはまる理由')
})

it('passes difficulty to both question writers without changing the flow paths', () => {
  expect(
    start.data.variables.find((v) => v.variable === 'difficulty_level')
  ).toMatchObject({
    options: ['1', '2', '3', '4', '5', '6'],
    default: '2',
    required: false,
  })
  expect(
    start.data.variables.find((v) => v.variable === 'bloom_level').default
  ).toBeUndefined()
  for (const id of ['1781845615892', '1791150000002']) {
    expect(prompt(id)).toContain(`{{#${start.id}.difficulty_level#}}`)
    expect(prompt(id)).toContain('知識点')
    expect(prompt(id)).toContain('基本')
  }
  expect(flow.workflow.graph.edges).toHaveLength(9)
})
