/** @jest-environment node */
const fs = require('fs')
const yaml = require('js-yaml')

const flowPath = fs.readdirSync('.').find((name) => name.endsWith('1007.yml'))

if (!flowPath) throw new Error('問題プール生成フローが見つかりません。')

const flow = yaml.load(fs.readFileSync(flowPath, 'utf8'))
const nodes = flow.workflow.graph.nodes

const prompt = (id) =>
  nodes
    .find((node) => node.id === id)
    .data.prompt_template.map((item) => item.text)
    .join('\n')

it('asks learners to create and justify a real-life example', () => {
  const questionPrompt = prompt('1791150000002')

  expect(questionPrompt).toContain('実生活や身近な機器・サービス')
  expect(questionPrompt).toContain('学習者自身が考え')
  expect(questionPrompt).toContain('具体例と理由の両方を求める')
  expect(questionPrompt).toContain(
    '教材内に例として示されているものを列挙・再現させる問題'
  )
  expect(questionPrompt).toContain('実生活のどんな場面で見られるかな')
  expect(questionPrompt).not.toContain(
    'exemplify（例示する）: 教材に明記された範囲で、概念に当てはまるものを挙げる。'
  )
})

it('treats the model answer as one valid example rather than the only answer', () => {
  const answerPrompt = prompt('1791150000003')

  expect(answerPrompt).toContain('正答例の1つとして作り')
  expect(answerPrompt).toContain('別の具体例でも教材の条件を満たせば')
  expect(answerPrompt).toContain('ブラウザ以外の例でも')
})
