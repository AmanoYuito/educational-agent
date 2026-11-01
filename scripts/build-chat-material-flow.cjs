// Reuse the pool's grounded four-choice generation, preserving chat/explanation.
const fs = require('fs')
const yaml = require('js-yaml')
const target = process.argv[2] || '問題解説別出力.yml'
const doc = yaml.load(fs.readFileSync(target, 'utf8'))
const pool = yaml.load(fs.readFileSync('AITuberKit-question-pool.yml', 'utf8'))
const generationIds = ['1781845615892', '1781845630001', '1781845630002', '1781845630003']
const remove = new Set(['1782175938408', '1782176027754'])
doc.workflow.graph.nodes = doc.workflow.graph.nodes.filter(n => !remove.has(n.id))
doc.workflow.graph.edges = doc.workflow.graph.edges.filter(e => !remove.has(e.source) && !remove.has(e.target))
const nodes = doc.workflow.graph.nodes
const start = nodes.find(n => n.data.type === 'start')
start.data.variables = start.data.variables.filter(v => !['topic', 'conversation_context', 'source_context'].includes(v.variable))
start.data.variables.push({ variable: 'source_context', label: '今回の教材本文（問題生成時にサーバーから渡す）', type: 'paragraph', required: false, max_length: 12000, options: [] })
for (const id of generationIds) {
  const node = nodes.find(n => n.id === id)
  const template = pool.workflow.graph.nodes.find(n => n.id === id)
  node.data.prompt_template = structuredClone(template.data.prompt_template)
  node.data.context = { enabled: false, variable_selector: [] }
  delete node.data.memory
  node.data.desc = 'ナレッジAPIから渡された今回の教材本文のみを根拠にする。'
  // No unsupported details just because a related term is present.
  node.data.prompt_template[0].text += '\n教材でSMTPという名称が出ていても、MAIL FROM・RCPT TO・DATA・ポート番号などの詳細が本文に書かれていなければ、それらを問題・選択肢・解説に追加しません。誤答も本文の用語・関係の取り違えで作り、誤りを説明するために外部知識を必要としないものにします。'
}
const branch = nodes.find(n => n.data.type === 'if-else')
const edgeId = `${branch.id}-true-1781845615892-target`
if (!doc.workflow.graph.edges.some(e => e.id === edgeId)) {
  doc.workflow.graph.edges.push({ id: edgeId, source: branch.id, sourceHandle: 'true', target: '1781845615892', targetHandle: 'target', type: 'custom', data: { sourceType: 'if-else', targetType: 'llm', isInIteration: false, isInLoop: false }, zIndex: 0 })
}
doc.app.description = '会話・追加解説と、ナレッジAPIからサーバーが選んだ教材本文に基づく4択問題生成。知識検索・キーワード生成ノードは使用しない。'
fs.writeFileSync(target, yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: "'" }))
