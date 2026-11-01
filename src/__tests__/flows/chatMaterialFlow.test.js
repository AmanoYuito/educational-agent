/** @jest-environment node */
const fs = require('fs')
const yaml = require('js-yaml')
const flowFile = fs
  .readdirSync('.')
  .find((name) => name.startsWith('問題解説別出力チャット'))
const flow = yaml.load(fs.readFileSync(flowFile, 'utf8'))
const { nodes, edges } = flow.workflow.graph
const start = nodes.find((n) => n.data.type === 'start')
const branch = nodes.find((n) => n.data.type === 'if-else')
const byId = new Map(nodes.map((n) => [n.id, n]))
function route(handle) {
  const result = []
  let edge = edges.find(
    (e) => e.source === branch.id && e.sourceHandle === handle
  )
  while (edge) {
    if (result.some((n) => n.id === edge.target)) throw Error('cycle')
    const node = byId.get(edge.target)
    result.push(node)
    edge = edges.find((e) => e.source === node.id)
  }
  return result
}
test('generation requests an approved question from the server-side pool', () => {
  expect(
    nodes.some((n) => ['code', 'knowledge-retrieval'].includes(n.data.type))
  ).toBe(false)
  const inputNames = start.data.variables.map((v) => v.variable)
  expect(inputNames).toEqual(
    expect.arrayContaining([
      'question_type',
      'source_dataset_id',
      'question_pool_api_url',
      'question_pool_request_token',
    ])
  )
  expect(inputNames).not.toContain('source_context')

  const generated = route('true')
  expect(generated.map((n) => n.data.type)).toEqual(['http-request', 'answer'])
  const request = generated[0].data
  expect(request.url).toBe(`{{#${start.id}.question_pool_api_url#}}`)
  expect(request.headers).toContain(
    `Bearer {{#${start.id}.question_pool_request_token#}}`
  )
  expect(JSON.stringify(request.body)).toContain(
    `{{#${start.id}.source_dataset_id#}}`
  )
  expect(JSON.stringify(request)).not.toMatch(
    /answerIndex|correct_answer|explanation/
  )
  expect(generated[1].data.answer).toBe('{{#question-pool-request.body#}}')
})
test('normal conversation and explanation keep their independent route', () => {
  expect(route('false').map((n) => n.data.type)).toEqual(['llm', 'answer'])
  const text = route('false')[0]
    .data.prompt_template.map((p) => p.text)
    .join('\n')
  expect(text).toContain('explain_quiz')
  expect(text).toContain('具体例')
})
test('learning feedback uses actual attempts and coaches understanding skills', () => {
  const text = route('false')[0]
    .data.prompt_template.map((p) => p.text)
    .join('\n')
  expect(text).toContain('learning_feedback_data')
  expect(text).toContain('問題の内容や正誤の情報が届いていない')
  expect(text).toContain('何がどの分類に当てはまるか')
  expect(text).toContain('共通点と違いを分けて説明')
})
test('all generation references point to available upstream outputs', () => {
  const available = new Set([start.id, branch.id, 'sys'])
  for (const n of route('true')) {
    for (const match of JSON.stringify(n.data).matchAll(
      /\{\{#([^.]+)\.[^#]+#\}\}/g
    ))
      expect(available.has(match[1])).toBe(true)
    available.add(n.id)
  }
  for (const e of edges) {
    expect(byId.has(e.source)).toBe(true)
    expect(byId.has(e.target)).toBe(true)
  }
})
