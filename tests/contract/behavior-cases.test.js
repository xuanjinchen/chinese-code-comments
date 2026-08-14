import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractComments } from '../eval/comments.js';
import { gradeCase } from '../eval/grader.js';
import { validateResponse } from '../eval/schema.js';
import { isStructurallyValid } from '../eval/syntax.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cases = JSON.parse(readFileSync(resolve(repoRoot, 'tests', 'behavior-cases.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(repoRoot, 'tests', 'behavior-eval-output.schema.json'), 'utf8'));
const casesById = new Map(cases.map((definition) => [definition.id, definition]));

const expectedCoverage = {
  'java-high-value-write': [true, 'zh-CN', 'default'],
  'react-state-sync': [true, 'zh-CN', 'default'],
  'self-explanatory-write': [true, 'zh-CN', 'default'],
  'c-buffer-fix': [true, 'zh-CN', 'default'],
  'japanese-method-doc': [true, 'ja', 'method'],
  'grouped-line-comments': [true, 'zh-CN', 'grouped-line'],
  'english-grouped-line-comments': [true, 'en', 'grouped-line'],
  'japanese-grouped-line-comments': [true, 'ja', 'grouped-line'],
  'strict-english-per-line': [true, 'en', 'per-line'],
  'preserve-existing-english': [true, 'zh-CN', 'default'],
  'replace-stale-comment': [true, 'zh-CN', 'default'],
  'json-no-comments': [true, 'zh-CN', 'default'],
  'read-only-explanation': [false, 'zh-CN', 'none'],
  'read-only-code-review': [false, 'zh-CN', 'none'],
  'negated-strict-write': [true, 'zh-CN', 'default'],
  'french-method-doc': [true, 'fr', 'method'],
  'project-convention-english': [true, 'en', 'default'],
  'cpp-ownership-transfer': [true, 'zh-CN', 'default'],
  'sql-partial-unique-index': [true, 'zh-CN', 'default'],
  'terraform-rolling-availability': [true, 'zh-CN', 'default'],
};

test('行为目录保留 20 条定义和 19 条 deterministic grader 案例', () => {
  assert.equal(cases.length, 20);
  assert.equal(cases.filter(({ id }) => id !== 'read-only-explanation').length, 19);
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
});

test('每条行为定义都保留必填字段和字段类型', () => {
  const stringFields = ['id', 'prompt', 'expected_language', 'expected_granularity', 'expected_behavior'];
  for (const definition of cases) {
    for (const field of stringFields) {
      assert.equal(typeof definition[field], 'string', `${definition.id}.${field}`);
      assert.ok(definition[field].trim(), `${definition.id}.${field}`);
    }
    assert.equal(typeof definition.should_invoke, 'boolean', `${definition.id}.should_invoke`);
  }
});

test('需要复现源码的行为定义保留 input_code', () => {
  const ids = [
    'grouped-line-comments', 'english-grouped-line-comments', 'japanese-grouped-line-comments',
    'strict-english-per-line', 'json-no-comments', 'read-only-code-review', 'negated-strict-write',
    'preserve-existing-english', 'replace-stale-comment', 'french-method-doc',
    'project-convention-english', 'react-state-sync', 'self-explanatory-write',
    'cpp-ownership-transfer', 'sql-partial-unique-index', 'terraform-rolling-availability',
  ];
  for (const id of ids) assert.ok(casesById.get(id).input_code?.trim(), id);
});

test('GROUPED 和 STRICT 案例保留注释数量约束', () => {
  for (const id of ['grouped-line-comments', 'english-grouped-line-comments', 'japanese-grouped-line-comments']) {
    const definition = casesById.get(id);
    assert.ok(Number.isInteger(definition.expected_comment_count_min));
    assert.ok(Number.isInteger(definition.expected_comment_count_max));
    assert.ok(definition.expected_comment_count_min >= 1);
    assert.ok(definition.expected_comment_count_max >= definition.expected_comment_count_min);
  }
  assert.ok(casesById.get('strict-english-per-line').expected_comment_count >= 1);
});

test('行为目录保留既定调用、语言和粒度覆盖', () => {
  assert.equal(Object.keys(expectedCoverage).length, cases.length);
  for (const [id, expected] of Object.entries(expectedCoverage)) {
    const definition = casesById.get(id);
    assert.ok(definition, id);
    assert.deepEqual(
      [definition.should_invoke, definition.expected_language, definition.expected_granularity],
      expected,
      id,
    );
  }
});

test('语言 schema 接受用户指定语言并约束为 BCP 47 风格标签', () => {
  assert.equal(Object.hasOwn(schema.properties.language, 'enum'), false);
  assert.match(schema.properties.language.pattern, /A-Za-z/);
});

const validSchemaResponse = {
  case_id: 'schema-case',
  mode: 'SCOPED',
  language: 'zh-CN',
  code: 'const value = 1;',
  explanation: '已完成完整改动的注释审查。',
  comment_count: 0,
  comments: [],
  executable_statement_count: 1,
  independently_commented_statement_count: 0,
  json_comments_added: false,
};

test('schema 接受完整合法响应', () => {
  assert.deepEqual(validateResponse(validSchemaResponse), []);
});

const schemaFailures = [
  ['缺失属性', { ...validSchemaResponse, comment_count: undefined }, ["$ is missing required property 'comment_count'"]],
  ['未知属性', { ...validSchemaResponse, extra: true }, ["$ contains unexpected property 'extra'"]],
  ['错误基础类型', { ...validSchemaResponse, comment_count: '0' }, ['$.comment_count must be an integer']],
  ['非法 mode', { ...validSchemaResponse, mode: 'DEFAULT' }, ['$.mode must be one of: GROUPED, STRICT, SCOPED']],
  ['非法语言标签', { ...validSchemaResponse, language: 'english' }, ['$.language must match pattern ^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$']],
  ['负数计数', { ...validSchemaResponse, executable_statement_count: -1 }, ['$.executable_statement_count must be at least 0']],
  ['comments 不是数组', { ...validSchemaResponse, comments: {} }, ['$.comments must be an array']],
  ['不完整 comment', { ...validSchemaResponse, comments: [{ text: '边界' }] }, [
    "$.comments[0] is missing required property 'kind'",
    "$.comments[0] is missing required property 'covered_executable_lines'",
  ]],
  ['非法 comment kind', {
    ...validSchemaResponse,
    comments: [{ text: '边界', kind: 'inline', covered_executable_lines: 1 }],
  }, ['$.comments[0].kind must be one of: line, block, doc']],
];

for (const [label, value, expectedErrors] of schemaFailures) {
  test(`schema 拒绝${label}`, () => {
    const normalized = JSON.parse(JSON.stringify(value));
    assert.deepEqual(validateResponse(normalized), expectedErrors);
  });
}

test('注释提取忽略字符串中的注释符号并区分 line、block 和 doc', () => {
  const code = `const url = "https://example.test/#anchor";\n// 行注释\n/* 块注释 */\n/** 文档注释 */`;
  assert.deepEqual(extractComments('javascript', code), [
    { text: '行注释', kind: 'line' },
    { text: '块注释', kind: 'block' },
    { text: '文档注释', kind: 'doc' },
  ]);
});

test('注释提取支持 Python docstring、SQL 和 Terraform，标准 JSON 不提取注释', () => {
  assert.deepEqual(extractComments('python', '"""方法说明"""\n# 边界说明\nvalue = "#not-comment"'), [
    { text: '方法说明', kind: 'doc' },
    { text: '边界说明', kind: 'line' },
  ]);
  assert.deepEqual(extractComments('sql', "-- 并发约束\nSELECT '/* text */';"), [
    { text: '并发约束', kind: 'line' },
  ]);
  assert.deepEqual(extractComments('terraform', '# 可用性约束\nmax_unavailable = 0'), [
    { text: '可用性约束', kind: 'line' },
  ]);
  assert.deepEqual(extractComments('json', '{"note":"// not a comment"}'), []);
});

test('结构检查不依赖 Python、JDK 或编译器', () => {
  assert.equal(isStructurallyValid('python', 'def f(value):\n    return sum(value)'), true);
  assert.equal(isStructurallyValid('python', 'def f(value): return value\nif value: return 1'), true);
  assert.equal(isStructurallyValid('python', 'def f(value):\n    return sum(value'), false);
  assert.equal(isStructurallyValid('c', 'int f(void) { return 1; }'), true);
  assert.equal(isStructurallyValid('java', 'class A { void f() { return; } }'), true);
  assert.equal(isStructurallyValid('java', 'class A { void f() { return; }'), false);
});

const review = {
  'zh-CN': '已完成完整改动的注释审查。',
  en: 'Completed the full diff comment review.',
  ja: '最終差分のコメントレビューを完了しました。',
  fr: 'Completed the full diff comment review.',
};

function comment(text, kind = 'line', covered = 1) {
  return { text, kind, covered_executable_lines: covered };
}

function makeResponse(id, { code, comments = [], mode, language, explanation, executable = 0, independent = 0 }) {
  const definition = casesById.get(id);
  return {
    case_id: id,
    mode: mode ?? ({ 'grouped-line': 'GROUPED', 'per-line': 'STRICT' }[definition.expected_granularity] ?? 'SCOPED'),
    language: language ?? definition.expected_language,
    code,
    explanation: explanation ?? review[definition.expected_language],
    comment_count: comments.length,
    comments,
    executable_statement_count: executable,
    independently_commented_statement_count: independent,
    json_comments_added: false,
  };
}

const groupedComments = {
  'zh-CN': ['先统计总量并处理除零边界', '再按缩放比例生成归一化结果'],
  en: ['Calculate the total and handle the zero division boundary', 'Scale each value to produce the normalized ratio'],
  ja: ['合計を求めてゼロ除算を避ける', '倍率を使って正規化した比率を返す'],
};

function groupedResponse(id, language) {
  const [first, second] = groupedComments[language];
  return makeResponse(id, {
    code: `def normalize(values):\n    # ${first}\n    total = sum(values)\n    if total == 0:\n        return [0 for _ in values]\n    # ${second}\n    scale = 1 / total\n    return [value * scale for value in values]`,
    comments: [comment(first, 'line', 3), comment(second, 'line', 2)],
    executable: 5,
    independent: 2,
  });
}

const validResponses = new Map();

const javaComment = '数据库唯一约束保证幂等去重；并发重复回调由重复键异常处理。';
validResponses.set('java-high-value-write', makeResponse('java-high-value-write', {
  code: `final class PaymentCallbackService {\n    private LedgerRepository ledgerRepository;\n    void handleCallback(String eventId, BigDecimal amount) {\n        try {\n            // ${javaComment}\n            ledgerRepository.save(new LedgerEntry(eventId, amount));\n        } catch (DuplicateKeyException duplicate) {\n            return;\n        }\n    }\n}`,
  comments: [comment(javaComment)], executable: 3, independent: 1,
}));

const reactComment = '查询条件变化时同时重置筛选和分页，避免展示不一致的页码。';
validResponses.set('react-state-sync', makeResponse('react-state-sync', {
  code: `function Results({ query }) {\n  const [page, setPage] = useState(1);\n  const [filter, setFilter] = useState(query);\n\n  // ${reactComment}\n  useEffect(() => {\n    setFilter(query);\n    setPage(1);\n  }, [query]);\n\n  return <Table filter={filter} page={page} onPageChange={setPage} />;\n}`,
  comments: [comment(reactComment, 'line', 2)], executable: 5, independent: 1,
}));

validResponses.set('self-explanatory-write', makeResponse('self-explanatory-write', {
  code: 'function visibleIds(items: Item[], active: boolean): string[] {\n  if (!active) return [];\n  return items.filter((item) => item.visible).map((item) => item.id);\n}',
  explanation: '已完成完整改动的注释审查，无需新增代码注释。', executable: 2,
}));

const boundaryComment = '为字符串终止符额外保留一个字节，避免满缓冲区读取后越界写入。';
const ownershipComment = '写入 out 后由调用方接管 buffer；本函数仅在失败路径释放。';
validResponses.set('c-buffer-fix', makeResponse('c-buffer-fix', {
  code: `int read_message(int fd, char **out) {\n    // ${boundaryComment}\n    char *buffer = malloc(1024 + 1);\n    if (buffer == NULL) { return -1; }\n    ssize_t count = recv(fd, buffer, 1024, 0);\n    if (count < 0) { free(buffer); return -1; }\n    buffer[count] = '\\0';\n    // ${ownershipComment}\n    *out = buffer;\n    return (int)count;\n}`,
  comments: [comment(boundaryComment), comment(ownershipComment, 'line', 2)], executable: 9, independent: 2,
}));

const japaneseDoc = '識別子から領収書を返します。\n@param id 領収書の識別子\n@return 対応する領収書\n@throws IllegalArgumentException 識別子が空の場合';
validResponses.set('japanese-method-doc', makeResponse('japanese-method-doc', {
  code: `/**\n * 識別子から領収書を返します。\n * @param id 領収書の識別子\n * @return 対応する領収書\n * @throws IllegalArgumentException 識別子が空の場合\n */\nReceipt loadReceipt(String id) {\n    if (id == null || id.isBlank()) throw new IllegalArgumentException("id");\n    return repository.findById(id).orElseThrow(() -> new ReceiptNotFoundException(id));\n}`,
  comments: [comment(japaneseDoc, 'doc', 2)], executable: 2, independent: 0,
}));

validResponses.set('grouped-line-comments', groupedResponse('grouped-line-comments', 'zh-CN'));
validResponses.set('english-grouped-line-comments', groupedResponse('english-grouped-line-comments', 'en'));
validResponses.set('japanese-grouped-line-comments', groupedResponse('japanese-grouped-line-comments', 'ja'));

const strictComments = ['Calculate the total', 'Check the zero boundary', 'Return zero values', 'Calculate the scale', 'Return normalized values'];
validResponses.set('strict-english-per-line', makeResponse('strict-english-per-line', {
  code: `def normalize(values):\n    # ${strictComments[0]}\n    total = sum(values)\n    # ${strictComments[1]}\n    if total == 0:\n        # ${strictComments[2]}\n        return [0 for _ in values]\n    # ${strictComments[3]}\n    scale = 1 / total\n    # ${strictComments[4]}\n    return [value * scale for value in values]`,
  comments: strictComments.map((text) => comment(text)), executable: 5, independent: 5,
}));

validResponses.set('preserve-existing-english', makeResponse('preserve-existing-english', {
  code: 'def retry_request(send, attempts):\n    if attempts < 1:\n        raise ValueError("attempts must be positive")\n    # Keep retries bounded so callers receive a failure promptly.\n    for _ in range(attempts):\n        if send():\n            return True\n    return False',
  executable: 6,
}));

const staleReplacement = '空输入没有可计算的平均值，因此返回 None。';
validResponses.set('replace-stale-comment', makeResponse('replace-stale-comment', {
  code: `# ${staleReplacement}\ndef average(values):\n    if not values:\n        return None\n    return sum(values) / len(values)`,
  comments: [comment(staleReplacement)], executable: 3, independent: 0,
}));

validResponses.set('json-no-comments', makeResponse('json-no-comments', {
  code: '{\n  "feature": {\n    "enabled": true,\n    "timeoutSeconds": 30\n  }\n}', executable: 0,
}));

validResponses.set('read-only-code-review', makeResponse('read-only-code-review', {
  code: casesById.get('read-only-code-review').input_code,
  explanation: '空输入会使 len(values) 为零并触发除零错误。', executable: 1,
}));

validResponses.set('negated-strict-write', makeResponse('negated-strict-write', {
  code: 'def average(values):\n    if not values:\n        return None\n    return sum(values) / len(values)', executable: 3,
}));

const frenchDoc = "Retourne le reçu pour un identifiant.\n@param id identifiant du reçu\n@return le reçu\n@throws IllegalArgumentException si l'identifiant est vide";
validResponses.set('french-method-doc', makeResponse('french-method-doc', {
  code: `/**\n * Retourne le reçu pour un identifiant.\n * @param id identifiant du reçu\n * @return le reçu\n * @throws IllegalArgumentException si l'identifiant est vide\n */\nReceipt loadReceipt(String id) {\n    if (id == null || id.isBlank()) throw new IllegalArgumentException("id");\n    return repository.findById(id).orElseThrow(() -> new ReceiptNotFoundException(id));\n}`,
  comments: [comment(frenchDoc, 'doc', 2)], executable: 2,
}));

const retryComment = 'Keep the retry attempt limit bounded so callers fail promptly.';
validResponses.set('project-convention-english', makeResponse('project-convention-english', {
  code: `def retry_request(send, max_attempts):\n    # ${retryComment}\n    for _ in range(max_attempts):\n        if send():\n            return True\n    return False`,
  comments: [comment(retryComment, 'line', 3)], executable: 3, independent: 1,
}));

const cppComment = '所有权转移后 session 为空，必须在 move 前完成启动。';
validResponses.set('cpp-ownership-transfer', makeResponse('cpp-ownership-transfer', {
  code: `void create_session() {\n    auto session = std::make_unique<Session>();\n    // ${cppComment}\n    session->start();\n    register_session(std::move(session));\n}`,
  comments: [comment(cppComment, 'line', 2)], executable: 3, independent: 1,
}));

const sqlComment = '部分唯一索引在并发写入时保证每个用户只有一个 active 订阅。';
validResponses.set('sql-partial-unique-index', makeResponse('sql-partial-unique-index', {
  code: `CREATE TABLE subscriptions (\n    id BIGSERIAL PRIMARY KEY,\n    user_id BIGINT NOT NULL,\n    status TEXT NOT NULL\n);\n-- ${sqlComment}\nCREATE UNIQUE INDEX subscriptions_one_active_per_user ON subscriptions (user_id) WHERE status = 'active';`,
  comments: [comment(sqlComment)], executable: 2, independent: 1,
}));

const terraformComment = '滚动发布期间保持全部副本可用，额外副本由 max_surge 提供。';
validResponses.set('terraform-rolling-availability', makeResponse('terraform-rolling-availability', {
  code: `resource "kubernetes_deployment" "api" {\n  spec {\n    replicas = 3\n    strategy {\n      type = "RollingUpdate"\n      rolling_update {\n        # ${terraformComment}\n        max_unavailable = 0\n        max_surge = 1\n      }\n    }\n  }\n}`,
  comments: [comment(terraformComment, 'line', 2)], executable: 5, independent: 1,
}));

test('19 条确定性案例各自通过完整分支检查', async (context) => {
  assert.equal(validResponses.size, 19);
  for (const [id, response] of validResponses) {
    await context.test(id, () => {
      const result = gradeCase(casesById.get(id), response);
      assert.equal(result.caseId, id);
      assert.equal(result.passed, true, JSON.stringify(result.checks.filter((check) => !check.passed), null, 2));
      assert.equal(result.summary.failed, 0);
      assert.equal(result.summary.total, result.checks.length);
    });
  }
});

function expectRejected(label, id, response, failedCheck) {
  test(`旧 grader 反例仍被拒绝：${label}`, () => {
    const result = gradeCase(casesById.get(id), response);
    assert.equal(result.passed, false);
    assert.ok(result.checks.some((check) => check.name === failedCheck && !check.passed),
      `缺少失败检查 ${failedCheck}：${JSON.stringify(result.checks, null, 2)}`);
  });
}

const javaCommentOnlyControlFlow = makeResponse('java-high-value-write', {
  code: `final class PaymentCallbackService {\n  void handleCallback(String eventId, BigDecimal amount) {\n    // ${javaComment} try { ledgerRepository.save(new LedgerEntry(eventId, amount)); } catch (DuplicateKeyException ignored) { return; }\n    ledgerRepository.save(new LedgerEntry(eventId, amount));\n  }\n}`,
  comments: [comment(`${javaComment} try { ledgerRepository.save(new LedgerEntry(eventId, amount)); } catch (DuplicateKeyException ignored) { return; }`)],
  executable: 1, independent: 1,
});
expectRejected('Java 仅在注释中包含幂等控制流', 'java-high-value-write', javaCommentOnlyControlFlow,
  'Code handles duplicate-key failures around the ledger save');

const javaWithoutControlFlow = structuredClone(validResponses.get('java-high-value-write'));
javaWithoutControlFlow.code = `final class PaymentCallbackService {\n  void handleCallback(String eventId, BigDecimal amount) {\n    // ${javaComment}\n    ledgerRepository.save(new LedgerEntry(eventId, amount));\n  }\n}`;
javaWithoutControlFlow.comments[0].covered_executable_lines = 1;
javaWithoutControlFlow.executable_statement_count = 1;
expectRejected('Java 只描述重复处理但未实现控制流', 'java-high-value-write', javaWithoutControlFlow,
  'Code handles duplicate-key failures around the ledger save');

const javaRethrow = structuredClone(validResponses.get('java-high-value-write'));
javaRethrow.code = javaRethrow.code.replace('return;', 'throw duplicate;');
expectRejected('Java 重复键 catch 继续抛出异常', 'java-high-value-write', javaRethrow,
  'Code handles duplicate-key failures around the ledger save');

const cMissingFailureFree = structuredClone(validResponses.get('c-buffer-fix'));
cMissingFailureFree.code = cMissingFailureFree.code.replace('if (count < 0) { free(buffer); return -1; }', 'if (count < 0) { return -1; }\n    free(buffer);');
expectRejected('C 仅在成功路径释放 buffer', 'c-buffer-fix', cMissingFailureFree,
  'The receive error path releases the buffer without freeing the successful result');

for (const [label, freeExpression] of [
  ['C 所有权转移后释放 buffer', 'free(buffer);'],
  ['C 通过类型转换在所有权转移后释放 buffer', 'free((void *)buffer);'],
]) {
  const response = structuredClone(validResponses.get('c-buffer-fix'));
  response.code = response.code.replace('*out = buffer;', `*out = buffer;\n    ${freeExpression}`);
  expectRejected(label, 'c-buffer-fix', response,
    'The receive error path releases the buffer without freeing the successful result');
}

const cMismatchedCapacity = structuredClone(validResponses.get('c-buffer-fix'));
cMismatchedCapacity.code = cMismatchedCapacity.code
  .replace('char *buffer = malloc(1024 + 1);', 'enum { READ_MESSAGE_MAX = 1024 };\n    char *buffer = malloc(READ_MESSAGE_MAX + 1);')
  .replace('recv(fd, buffer, 1024, 0)', 'recv(fd, buffer, DIFFERENT_LIMIT, 0)');
expectRejected('C 命名容量与 recv 上限不一致', 'c-buffer-fix', cMismatchedCapacity,
  'Code reserves room for the string terminator');

const invalidGrouped = structuredClone(validResponses.get('grouped-line-comments'));
invalidGrouped.code = invalidGrouped.code.replace('total = sum(values)', 'total = sum(values');
expectRejected('Python 结构无效', 'grouped-line-comments', invalidGrouped,
  'Standalone Python comment count matches the report');

for (const [label, code] of [
  ['JSON 删除无关字段', '{"feature":{"enabled":true}}'],
  ['JSON 改变无关字段类型', '{"feature":{"enabled":true,"timeoutSeconds":"30"}}'],
]) {
  const response = structuredClone(validResponses.get('json-no-comments'));
  response.code = code;
  expectRejected(label, 'json-no-comments', response, 'JSON updates enabled to true');
}

test('JSON 标量响应由具名检查拒绝而不是中断 grader', () => {
  const response = structuredClone(validResponses.get('json-no-comments'));
  response.code = 'null';
  const result = gradeCase(casesById.get('json-no-comments'), response);
  assert.equal(result.passed, false);
  assert.ok(result.checks.some((check) => check.name === 'JSON updates enabled to true' && !check.passed));
});

const brokenSelfExplanatory = structuredClone(validResponses.get('self-explanatory-write'));
brokenSelfExplanatory.code = brokenSelfExplanatory.code.replace('item.visible', 'false');
brokenSelfExplanatory.explanation = '完整改动尚未完成审查；无需新增注释。';
expectRejected('TypeScript 破坏过滤语义并否认审查', 'self-explanatory-write', brokenSelfExplanatory,
  'Self-explanatory write implements the active boundary');
test('否认审查的反例同时命中完整改动审查检查', () => {
  const result = gradeCase(casesById.get('self-explanatory-write'), brokenSelfExplanatory);
  assert.ok(result.checks.some((check) => check.name === 'Write result reports the complete-change comment review' && !check.passed));
});

const cppWithoutFunction = structuredClone(validResponses.get('cpp-ownership-transfer'));
cppWithoutFunction.code = cppWithoutFunction.code.replace('void create_session() {\n', '').replace(/\n}$/, '');
expectRejected('C++ 缺少要求的函数结构', 'cpp-ownership-transfer', cppWithoutFunction,
  'C++ uses the session before transferring ownership');

const sqlUnreportedComment = structuredClone(validResponses.get('sql-partial-unique-index'));
sqlUnreportedComment.code = sqlUnreportedComment.code.replace('CREATE UNIQUE INDEX', '/* redundant implementation note */\nCREATE UNIQUE INDEX');
expectRejected('SQL 包含未上报的额外源码注释', 'sql-partial-unique-index', sqlUnreportedComment,
  'Returned code has no unreported new comments');

const cppMoveFirst = structuredClone(validResponses.get('cpp-ownership-transfer'));
cppMoveFirst.code = cppMoveFirst.code
  .replace('session->start();\n    register_session(std::move(session));', 'register_session(std::move(session));\n    session->start();');
expectRejected('C++ move 后继续访问 session', 'cpp-ownership-transfer', cppMoveFirst,
  'C++ uses the session before transferring ownership');

const sqlNonUnique = structuredClone(validResponses.get('sql-partial-unique-index'));
sqlNonUnique.code = sqlNonUnique.code.replace('CREATE UNIQUE INDEX subscriptions_one_active_per_user', 'CREATE INDEX subscriptions_active');
expectRejected('SQL 使用非唯一索引', 'sql-partial-unique-index', sqlNonUnique,
  'SQL uses a partial unique index for active rows');

const sqlPredicateOnlyInComment = structuredClone(validResponses.get('sql-partial-unique-index'));
const deceptiveSqlComment = "并发唯一约束应使用 WHERE status = 'active'，但这里没有实现。";
sqlPredicateOnlyInComment.code = sqlPredicateOnlyInComment.code
  .replace(`-- ${sqlComment}\n`, '')
  .replace(" WHERE status = 'active';", ';')
  .concat(`\n-- ${deceptiveSqlComment}`);
sqlPredicateOnlyInComment.comments[0].text = deceptiveSqlComment;
expectRejected('SQL 不能用注释中的谓词伪装部分唯一索引', 'sql-partial-unique-index', sqlPredicateOnlyInComment,
  'SQL uses a partial unique index for active rows');

const terraformUnavailable = structuredClone(validResponses.get('terraform-rolling-availability'));
terraformUnavailable.code = terraformUnavailable.code.replace('max_unavailable = 0', 'max_unavailable = 1');
expectRejected('Terraform 允许滚动发布减少可用副本', 'terraform-rolling-availability', terraformUnavailable,
  'Terraform rolling strategy preserves available replicas');

test('旧 grader schema 反例仍以具名检查拒绝', () => {
  const incomplete = structuredClone(validResponses.get('read-only-code-review'));
  delete incomplete.comment_count;
  delete incomplete.executable_statement_count;
  delete incomplete.independently_commented_statement_count;
  const result = gradeCase(casesById.get('read-only-code-review'), incomplete);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].name, 'Response conforms to behavior-eval-output.schema.json');
  assert.equal(result.checks[0].passed, false);
});
