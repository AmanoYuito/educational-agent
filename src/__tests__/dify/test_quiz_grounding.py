import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / 'dify' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


source_guard = load('quiz_source_guard')
output_guard = load('quiz_output_guard')
TEXT = 'コンピュータ同士がメールの送受信を行うときには、SMTPという通信プロトコルを用います。受信者が電子メールを自分のコンピュータに取り込む際に用いるプロトコルには、POP3、APOP、IMAPなどがあります。'
QUOTE = 'コンピュータ同士がメールの送受信を行うときには、SMTPという通信プロトコルを用います。'


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.source = source_guard.main([{'metadata': {'document_name': 'johokiso3-1-2.html'}, 'content': TEXT}])
        self.ref = {'source_id': 'S1', 'quote': QUOTE}
        self.question = {'question': 'メールの送受信に用いるプロトコルは何ですか。', 'evidence': self.ref}
        self.correct = {'correct_choice': 'SMTP', 'evidence': self.ref}
        self.quiz = {'type': 'quiz', 'public': {'question': self.question['question'], 'choices': ['POP3','SMTP','APOP','IMAP']},
                     'answerIndex': 1, 'answer': 'SMTP', 'explanation': 'SMTPを用います。',
                     'grounding': {'supported': True, 'question': self.ref, 'choices': [
                         {'choice': c, 'source_id':'S1','quote':TEXT,'reason':'教材の説明による。'}
                         for c in ['POP3','SMTP','APOP','IMAP']]}}

    def run_guard(self):
        return output_guard.main(json.dumps(self.question), json.dumps(self.correct), json.dumps(self.quiz), self.source['sources_json'])

    def test_valid_quiz_preserves_existing_api_schema_and_order(self):
        value = json.loads(self.run_guard()['result'])
        self.assertEqual(value['public']['choices'][value['answerIndex']], 'SMTP')
        self.assertEqual(set(value), {'type','public','answerIndex','answer','explanation'})

    def test_empty_and_other_lesson_retrieval_stop(self):
        for retrieval in [[], [{'title':'other.html','content':TEXT}], [{'title':'johokiso3-1-2.html','content':' '}]]:
            with self.subTest(retrieval=retrieval), self.assertRaises(ValueError):
                source_guard.main(retrieval)

    def test_mixed_documents_keep_only_target_and_deduplicate(self):
        items = [{'title':'other.html','content':'DNSではMXを用います。'}, {'title':'johokiso3-1-2.html','content':TEXT}]
        result = source_guard.main(items + [items[1]])
        self.assertEqual(len(json.loads(result['sources_json'])), 1)
        self.assertNotIn('DNS', result['context'])

    def test_conflicting_title_cannot_override_document_metadata(self):
        with self.assertRaises(ValueError):
            source_guard.main([{'title':'johokiso3-1-2.html','metadata':{'document_name':'other.html'},'content':TEXT}])

    def test_mx_question_with_real_but_irrelevant_quote_is_rejected(self):
        self.question['question'] = 'DNSで配送先を特定するレコードは何ですか。'
        self.quiz['public']['question'] = self.question['question']
        self.correct['correct_choice'] = 'MXレコード'
        self.quiz['public']['choices'][1] = self.quiz['answer'] = 'MXレコード'
        self.quiz['grounding']['choices'][1]['choice'] = 'MXレコード'
        with self.assertRaisesRegex(ValueError, '正解の語句'):
            self.run_guard()

    def test_fabricated_quotes_and_source_ids_are_rejected(self):
        for ref in [{'source_id':'S99','quote':QUOTE}, {'source_id':'S1','quote':'教材にはない説明を生成しました。'}]:
            self.question['evidence'] = ref
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                self.run_guard()

    def test_unknown_technical_term_in_distractor_is_rejected(self):
        self.quiz['public']['choices'][0] = 'CNAME'
        self.quiz['grounding']['choices'][0]['choice'] = 'CNAME'
        with self.assertRaisesRegex(ValueError, '教材にない用語'):
            self.run_guard()

    def test_insufficient_evidence_and_invalid_json_stop(self):
        self.quiz = {'status':'insufficient_evidence'}
        with self.assertRaises(ValueError): self.run_guard()
        with self.assertRaises(ValueError): output_guard.main('not json', '{}', '{}', self.source['sources_json'])

    def test_false_grounding_and_missing_option_evidence_stop(self):
        self.quiz['grounding']['supported'] = False
        with self.assertRaises(ValueError): self.run_guard()
        self.quiz['grounding']['supported'] = True
        self.quiz['grounding']['choices'].pop()
        with self.assertRaises(ValueError): self.run_guard()

    def test_wrong_index_duplicate_choices_and_changed_question_stop(self):
        original = copy.deepcopy(self.quiz)
        for mutate in [lambda q:q.update(answerIndex=True),lambda q:q.update(answerIndex=0),lambda q:q['public']['choices'].__setitem__(0,'SMTP'),lambda q:q['public'].update(question='別の問題')]:
            self.quiz=copy.deepcopy(original);mutate(self.quiz)
            with self.subTest(quiz=self.quiz), self.assertRaises(ValueError): self.run_guard()


if __name__ == '__main__':
    unittest.main()
