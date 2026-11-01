/** @jest-environment node */
const fs = require('fs')
const yaml = require('js-yaml')
const flow = yaml.load(
  fs.readFileSync('AITuberKit 教材ランダム出題.yml', 'utf8')
)
const { nodes, edges } = flow.workflow.graph
const byId = new Map(nodes.map((n) => [n.id, n]))
const start = nodes.find((n) => n.data.type === 'start')
const branch = nodes.find((n) => n.data.type === 'if-else')
function path(handle) {
  let edge = edges.find(
    (e) => e.source === branch.id && e.sourceHandle === handle
  )
  const result = []
  while (edge) {
    const node = byId.get(edge.target)
    if (result.includes(node)) throw new Error('Cycle')
    result.push(node)
    edge = edges.find((e) => e.source === node.id)
  }
  return result
}
it('has separate two-LLM written and four-LLM multiple-choice paths', () => {
  expect(branch.data.cases[0].conditions[0]).toMatchObject({
    value: 'written',
    variable_selector: [start.id, 'question_type'],
  })
  const written = path('true')
  const choices = path('false')
  expect(written.filter((n) => n.data.type === 'llm')).toHaveLength(2)
  expect(choices.filter((n) => n.data.type === 'llm')).toHaveLength(4)
  expect(written[1].data.prompt_template[0].text).toContain(
    `{{#${written[0].id}.text#}}`
  )
  expect(written[1].data.prompt_template[0].text).toContain(
    `{{#${start.id}.source_context#}}`
  )
  expect(written[2].data.answer).toBe(`{{#${written[1].id}.text#}}`)
  expect(choices[4].data.answer).toBe(`{{#${choices[3].id}.text#}}`)
  expect(written.some((n) => choices.includes(n))).toBe(false)
})
it('applies cognitive levels only to written nodes and allows the input to be omitted', () => {
  const level = start.data.variables.find((v) => v.variable === 'bloom_level')
  expect(level.required).toBe(false)
  expect(level.default).toBeUndefined()
  expect(
    start.data.variables.find((v) => v.variable === 'bloom_level').options
  ).toEqual(['remember', 'understand'])
  expect(
    start.data.variables.find((v) => v.variable === 'question_type').options
  ).toEqual(['multiple_choice', 'written'])
  for (const node of nodes.filter((n) => n.data.type === 'llm')) {
    const text = node.data.prompt_template.map((p) => p.text).join('\n')
    expect(text).toContain(`{{#${start.id}.source_context#}}`)
    if (path('true').includes(node))
      expect(text).toContain(`{{#${start.id}.bloom_level#}}`)
    else
      expect(text).not.toMatch(
        /bloom_level|bloomLevel|remember|understand|Remember|Understand/
      )
    expect(text).toContain('insufficient_material')
    expect(node.data.memory).toBeUndefined()
  }
})
it('only references available upstream values along each branch', () => {
  expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  for (const e of edges) {
    expect(byId.has(e.source)).toBe(true)
    expect(byId.has(e.target)).toBe(true)
  }
  for (const handle of ['true', 'false']) {
    const available = new Map([
      [start.id, start.data.variables.map((v) => v.variable)],
    ])
    for (const node of path(handle)) {
      const text =
        (node.data.prompt_template || []).map((p) => p.text).join('\n') +
        (node.data.answer || '')
      for (const [, id, variable] of text.matchAll(
        /\{\{#([^.]+)\.([^#]+)#\}\}/g
      )) {
        expect(available.get(id)).toContain(variable)
      }
      if (node.data.type === 'llm') available.set(node.id, ['text'])
    }
  }
})
it('ships identical import and deployment flows', () => {
  expect(
    yaml.load(fs.readFileSync('AITuberKit-question-pool.yml', 'utf8'))
  ).toEqual(flow)
})
it('deployment preflight accepts the new inputs and rejects stale published flows', () => {
  const { spawnSync } = require('child_process')
  const parameters = {
    user_input_form: start.data.variables.map((v) => ({ [v.type]: v })),
  }
  const code = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('check','scripts/check-question-material.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.validate_pool_parameters(json.load(sys.stdin))`
  const check = (p) =>
    spawnSync('python3', ['-c', code], {
      input: JSON.stringify(p),
      encoding: 'utf8',
    })
  expect(check(parameters).status).toBe(0)
  expect(
    check({ user_input_form: parameters.user_input_form.slice(0, 1) }).status
  ).not.toBe(0)
  const unsupported = JSON.parse(JSON.stringify(parameters))
  unsupported.user_input_form[2].select.options.push('apply')
  expect(check(unsupported).status).not.toBe(0)
})
