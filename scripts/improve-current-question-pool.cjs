const fs = require('fs')
const yaml = require('js-yaml')

const [input, output] = process.argv.slice(2)
if (!input || !output)
  throw new Error('Usage: node scripts/improve-current-question-pool.cjs INPUT.yml OUTPUT.yml')

const flow = yaml.load(fs.readFileSync(input, 'utf8'))
const nodes = new Map(flow.workflow.graph.nodes.map((node) => [node.id, node]))
const start = nodes.get('1781845499006')
if (!start || !nodes.get('1781845615892') || !nodes.get('1791150000002'))
  throw new Error('Expected question-pool flow nodes are missing')

const difficultyVariable = {
  label: '難易度（1〜2: 基本 / 3〜4: 標準 / 5〜6: 発展）',
  variable: 'difficulty_level',
  type: 'select',
  required: false,
  default: '2',
  options: ['1', '2', '3', '4', '5', '6'],
}
start.data.variables = [
  ...start.data.variables.filter((value) => value.variable !== 'difficulty_level'),
  difficultyVariable,
]
const bloomVariable = start.data.variables.find((value) => value.variable === 'bloom_level')
if (bloomVariable) delete bloomVariable.default

const prompt = (id) => {
  const node = nodes.get(id)
  if (!node?.data.prompt_template?.[0]) throw new Error(`Prompt missing: ${id}`)
  return node.data.prompt_template[0]
}
const difficulty = '{{#1781845499006.difficulty_level#}}'
const choiceQuestion = prompt('1781845615892')
const exampleStart = choiceQuestion.text.indexOf('# Few-shot例')
if (exampleStart < 0) throw new Error('Four-choice examples are missing')
choiceQuestion.text = `${choiceQuestion.text.slice(0, exampleStart)}# 難易度と知識点の選択
指定難易度: ${difficulty}（空欄なら2）
1〜2: 用語、名称、役割、明記された単一の事実を短く直接問う。初学者が語句を確認できる問題を優先する。
3〜4: 具体的な仕組みや特徴について、教材に明記された事実を一つ問う。基本的な語句確認も候補に残す。
5〜6: 教材の少し細かい記述を問う。ただし複数の知識点を同時に答えさせたり、教材外の知識を使わせたりしない。
難易度を上げるために長い問題文、抽象語、二重否定、ひっかけを使わない。
STEP 1では見出しだけでなく本文から独立した知識点をできるだけ多く抽出する。用語、定義、役割、対象、状態、順序などを別々の候補として扱う。最も難しい候補だけを選ばず、指定難易度に合う具体的な候補を選ぶ。目次や講義予定しかない箇所からは作問しない。
問題文は原則一文とし、「何を答えるか」が読んですぐ分かる形にする。

# Few-shot例（形式と難易度の参考。今回の教材に事実を流用しない）
例1・基本／語句
【教材】メールの送信に用いるプロトコルはSMTPである。
【出力】{"question":"メールの送信に使うプロトコルはどれですか。"}
例2・基本／役割
【教材】DNSはドメイン名をIPアドレスに対応付ける。
【出力】{"question":"DNSの役割として正しいものはどれですか。"}
例3・標準／明記された特徴
【教材】ラウンドロビン方式では、各プロセスへ一定時間ずつCPUを割り当てる。
【出力】{"question":"ラウンドロビン方式で、各プロセスに割り当てられるCPU時間の特徴はどれですか。"}
例4・発展／細かい事実
【教材】fork()の後、親と子は同じ命令位置から再開し、戻り値で区別する。
【出力】{"question":"fork()の後、親プロセスと子プロセスを区別するために使うものはどれですか。"}
`

const writtenQuestion = prompt('1791150000002')
writtenQuestion.text = `【難易度と問題文の優先ルール】
指定難易度: ${difficulty}（空欄なら2）
1〜2（基本）: 一つの用語・役割・短い仕組みの意味を、自分の言葉で一文程度で答えられる問いにする。用語名を答えるだけにはしない。理解の問い方が未指定なら、一つの対象の意味・働き・理由を優先し、比較や三つ以上の分類は選ばない。
3〜4（標準）: 教材に明記された理由、手順の一段階、二つの対象の違いを一つ問う。基本的な意味確認も候補に残す。
5〜6（発展）: 教材内に明記された関係をつなげる。ただし答えの要点は二つまで、教材外の応用は求めない。
Step 1では出題範囲の本文から独立した知識点をできるだけ多く洗い出し、用語・役割・理由・関係・順序を別々の候補として扱う。見出しや目次だけの記述は候補にしない。
Step 4で先に一〜二文の模範回答を想定し、Step 5ではその答えだけを求める自然な日本語の問題文を作る。主語、対象、答える観点を具体的に示す。「この内容」「この仕組み」など指示対象が不明な表現、抽象的な総論、独立した二つ以上の問いを避ける。基本レベルは回答要素を一つに絞る。難易度は知識点で調整し、文を難解にしない。
以下の作問例も参考にする。ただし例の事実は今回の教材には使わない。
基本｜教材「DNSはドメイン名をIPアドレスに対応付ける」→「DNSはドメイン名に対して何をする仕組み？」
標準｜教材「主記憶は実行中のデータを保持し、補助記憶は長期保存に使う」→「主記憶と補助記憶は、データを保持する目的がどう違う？」
標準｜教材「件名を簡潔で具体的にすると受信者が用件を把握しやすい」→「メールの件名を簡潔で具体的に書くと、受信者にとってどんな利点がある？」
発展｜教材「入出力待ちの間に別のプロセスを動かすとCPUの利用効率が高まる」→「入出力待ちの間に別のプロセスを動かすと、CPUを効率よく使えるのはなぜ？」
この節と既存の例が食い違う場合は、この節を優先する。

${writtenQuestion.text}`

const writtenAnswer = prompt('1791150000003')
const answerExamples = writtenAnswer.text.indexOf('Few-shot例')
const answerInputs = writtenAnswer.text.lastIndexOf('直前に生成された記述問題:')
if (answerExamples < 0 || answerInputs < answerExamples)
  throw new Error('Written-answer examples or inputs are missing')
const answerHead = writtenAnswer.text.slice(0, answerExamples)
  .replace('・教材本文にない外部知識を追加しない。', '・exemplifyの身近な具体例を除き、教材本文にない外部知識を追加しない。')
const answerTail = writtenAnswer.text.slice(answerInputs)
  .replace('補足根拠にしかない内容を問題・正答・誤答・解説に追加しないでください。', '補足根拠にしかない知識点を問題の中心に追加しないでください。exemplifyの具体例は身近な場面から補ってよいですが、正誤の判定条件は教材にある定義・特徴だけを使います。')
writtenAnswer.text = `【例示問題の模範回答】
exemplify では、模範回答を正答例の1つとして作り、教材の条件を満たす別の具体例も正解になり得ると解説に明記する。学習者が考える身近な例と、その例が当てはまる理由の両方を示す。具体例は教材にない身近な場面でもよいが、判定条件は教材から導く。

${answerHead}Few-shot例（今回の教材に事実を流用しない）
例1・基本／役割
【教材】DNSはドメイン名をIPアドレスに対応付ける。
【問題】{"question":"DNSはドメイン名に対して何をする仕組み？"}
【出力】{"type":"written","questionType":"written","bloomLevel":"understand","public":{"question":"DNSはドメイン名に対して何をする仕組み？"},"modelAnswer":"ドメイン名を対応するIPアドレスに結び付ける仕組み。","explanation":"教材に示されたDNSの役割を答えている。"}
例2・標準／違い
【教材】主記憶は実行中のデータを保持し、補助記憶は長期保存に使う。
【問題】{"question":"主記憶と補助記憶は、データを保持する目的がどう違う？"}
【出力】{"type":"written","questionType":"written","bloomLevel":"understand","public":{"question":"主記憶と補助記憶は、データを保持する目的がどう違う？"},"modelAnswer":"主記憶は実行中のデータを保持し、補助記憶はデータを長期保存する。","explanation":"教材にある二つの役割を比較している。"}
例3・例示
【教材】相互排除は共有資源への同時アクセスを防ぐ。
【問題】{"question":"共有資源を一度に一人だけが使う身近な例を一つ挙げ、相互排除に当たる部分を答えてみよう。"}
【出力】{"type":"written","questionType":"written","bloomLevel":"understand","public":{"question":"共有資源を一度に一人だけが使う身近な例を一つ挙げ、相互排除に当たる部分を答えてみよう。"},"modelAnswer":"一台の印刷機を順番に使う例。先に使っている人が終わるまで次の人が使わない部分が相互排除に当たる。","explanation":"教材にある同時アクセスを防ぐ条件を満たせば、別の具体例でも正解になり得る。"}

${answerTail}`

fs.writeFileSync(output, yaml.dump(flow, { lineWidth: 120, noRefs: true, quotingType: "'" }))
console.log('Created ' + output)
