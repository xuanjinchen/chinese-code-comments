import { isDeepStrictEqual } from 'node:util';
import { extractComments } from './comments.js';
import { codeOnly, isStructurallyValid } from './syntax.js';
import { validateResponse } from './schema.js';

const CASE_LANGUAGES = {
  'java-high-value-write': 'java',
  'react-state-sync': 'typescript',
  'self-explanatory-write': 'typescript',
  'c-buffer-fix': 'c',
  'japanese-method-doc': 'java',
  'grouped-line-comments': 'python',
  'english-grouped-line-comments': 'python',
  'japanese-grouped-line-comments': 'python',
  'strict-english-per-line': 'python',
  'preserve-existing-english': 'python',
  'replace-stale-comment': 'python',
  'json-no-comments': 'json',
  'read-only-code-review': 'python',
  'negated-strict-write': 'python',
  'french-method-doc': 'java',
  'project-convention-english': 'python',
  'cpp-ownership-transfer': 'cpp',
  'sql-partial-unique-index': 'sql',
  'terraform-rolling-availability': 'terraform',
};

function normalizeComment(value) {
  return String(value ?? '').replace(/^\s*(?:\/+|--+|#|\/\*+|\*+\/?|\*\/)\s*/gm, '').replace(/\s+/g, '');
}

function sqlWithoutComments(code) {
  let result = '';
  let state = 'code';
  let quote = '';

  // 保留 SQL 字符串字面量，只屏蔽注释，避免注释中的伪谓词参与迁移语义检查。
  for (let index = 0; index < code.length; index += 1) {
    const current = code[index];
    const next = code[index + 1] ?? '';
    if (state === 'code') {
      if (current === '-' && next === '-') {
        result += '  ';
        state = 'line';
        index += 1;
      } else if (current === '/' && next === '*') {
        result += '  ';
        state = 'block';
        index += 1;
      } else {
        result += current;
        if (current === "'" || current === '"') {
          state = 'string';
          quote = current;
        }
      }
    } else if (state === 'line') {
      result += current === '\r' || current === '\n' ? current : ' ';
      if (current === '\r' || current === '\n') state = 'code';
    } else if (state === 'block') {
      if (current === '*' && next === '/') {
        result += '  ';
        state = 'code';
        index += 1;
      } else {
        result += current === '\r' || current === '\n' ? current : ' ';
      }
    } else {
      result += current;
      if (current === quote && next === quote) {
        result += next;
        index += 1;
      } else if (current === quote) {
        state = 'code';
      }
    }
  }
  return result;
}

function expectedMode(definition) {
  if (definition.expected_granularity === 'grouped-line') return 'GROUPED';
  if (definition.expected_granularity === 'per-line') return 'STRICT';
  return 'SCOPED';
}

function commentBounds(definition) {
  if (Number.isInteger(definition.expected_comment_count)) {
    return { min: definition.expected_comment_count, max: definition.expected_comment_count, label: `exactly ${definition.expected_comment_count}` };
  }
  if (Number.isInteger(definition.expected_comment_count_min)) {
    return {
      min: definition.expected_comment_count_min,
      max: definition.expected_comment_count_max,
      label: `range ${definition.expected_comment_count_min}-${definition.expected_comment_count_max}`,
    };
  }
  const defaults = {
    'java-high-value-write': [1, 4],
    'c-buffer-fix': [2, 4],
    'japanese-method-doc': [1, 1],
    'json-no-comments': [0, 0],
    'read-only-code-review': [0, 0],
    'negated-strict-write': [0, 1],
    'preserve-existing-english': [0, 0],
    'replace-stale-comment': [1, 1],
    'french-method-doc': [1, 1],
    'project-convention-english': [1, 1],
  };
  const bounds = defaults[definition.id];
  if (!bounds) throw new Error(`No comment-count bounds for case: ${definition.id}`);
  return { min: bounds[0], max: bounds[1], label: bounds[0] === bounds[1] ? `exactly ${bounds[0]}` : `range ${bounds[0]}-${bounds[1]}` };
}

function reportedCommentsExist(language, code, comments) {
  const source = extractComments(language, code).map(({ text }) => normalizeComment(text));
  return comments.every(({ text }) => {
    const expected = normalizeComment(text);
    return expected && source.some((actual) => actual.includes(expected));
  });
}

function newSourceCommentsMatchReport(definition, language, code, comments) {
  const returned = extractComments(language, code).map(({ text }) => normalizeComment(text));
  const original = extractComments(language, definition.input_code ?? '').map(({ text }) => normalizeComment(text));

  // 先按多重集合扣除未变化旧注释，剩余库存必须与本次响应逐条对应。
  for (const oldComment of original) {
    const index = returned.indexOf(oldComment);
    if (index >= 0) returned.splice(index, 1);
  }
  const reported = comments.map(({ text }) => normalizeComment(text)).filter(Boolean);
  if (returned.length !== reported.length) return false;
  for (const sourceComment of returned) {
    const index = reported.findIndex((candidate) => sourceComment.includes(candidate) || candidate.includes(sourceComment));
    if (index < 0) return false;
    reported.splice(index, 1);
  }
  return reported.length === 0;
}

function usesExpectedLanguage(language, comments, explanation) {
  const texts = comments.length > 0 ? comments.map(({ text }) => String(text)) : [String(explanation)];
  const joined = texts.join(' ');
  if (language === 'zh-CN') return texts.every((text) => /[\u4e00-\u9fff]/u.test(text));
  if (language === 'ja') return /[\u3040-\u30ff]/u.test(joined);
  if (language === 'en') return texts.every((text) => /[A-Za-z]/u.test(text) && !/[\u3040-\u30ff\u4e00-\u9fff]/u.test(text));
  if (language === 'fr') return !/[\u3040-\u30ff\u4e00-\u9fff]/u.test(joined)
    && /\b(?:le|la|les|un|une|des|pour|retourne|si|lorsque|introuvable|reçu|identifiant)\b/iu.test(joined);
  return true;
}

function reportsCompleteReview(explanation) {
  const review = '(?:审查|review|レビュー|確認)';
  const negative = '(?:未(?:完成|执行|进行)|尚未(?:完成|执行|进行)?|没有(?:完成|执行|进行)|并未(?:完成|执行|进行)?|不曾(?:完成|执行|进行)?|not\\s+(?:completed|performed|done)|did\\s+not|never|without|していない|未実施)';
  if (new RegExp(`${negative}.{0,32}${review}|${review}.{0,32}${negative}`, 'isu').test(explanation)) return false;
  return /(完整|complete|diff|改动|修改).*(审查|review)|(审查|review).*(完整|complete|diff|改动|修改|完成|completed|确认)|(已完成|completed|已使用|used).*(审查|review)|最終.*(確認|レビュー)/isu.test(explanation);
}

function pythonMetrics(code) {
  const lines = code.split(/\r?\n/);
  let standaloneComments = 0;
  let executableStatements = 0;
  let independentlyCommentedStatements = 0;
  let activeSpan = null;
  const groupedSpans = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('#')) {
      if (activeSpan !== null) groupedSpans.push(activeSpan);
      standaloneComments += 1;
      activeSpan = 0;
      continue;
    }
    if (!trimmed || /^(?:def\s+|else\s*:|elif\s+|except\s*|finally\s*:)/u.test(trimmed)) continue;
    executableStatements += 1;
    if (activeSpan !== null) activeSpan += 1;
    let previous = index - 1;
    while (previous >= 0 && !lines[previous].trim()) previous -= 1;
    if (previous >= 0 && lines[previous].trim().startsWith('#')) independentlyCommentedStatements += 1;
  }
  if (activeSpan !== null) groupedSpans.push(activeSpan);
  return {
    structurallyValid: isStructurallyValid('python', code),
    standaloneComments,
    executableStatements,
    independentlyCommentedStatements,
    groupedSpans,
    maxGroupedSpan: groupedSpans.length > 0 ? Math.max(...groupedSpans) : 0,
  };
}

function resultFor(caseId, checks) {
  const passedCount = checks.filter(({ passed }) => passed).length;
  const failed = checks.length - passedCount;
  return {
    caseId,
    passed: failed === 0,
    checks,
    summary: {
      passed: passedCount,
      failed,
      total: checks.length,
      passRate: checks.length === 0 ? 0 : Math.round((passedCount / checks.length) * 10000) / 10000,
    },
  };
}

export function gradeCase(definition, response) {
  const schemaErrors = validateResponse(response);
  if (schemaErrors.length > 0) {
    return resultFor(definition.id, [{
      name: 'Response conforms to behavior-eval-output.schema.json',
      passed: false,
      evidence: schemaErrors.join('; '),
    }]);
  }

  const checks = [];
  const add = (name, passed, evidence) => checks.push({ name, passed: Boolean(passed), evidence });
  const comments = response.comments;
  const commentCount = comments.length;
  const bounds = commentBounds(definition);
  const language = CASE_LANGUAGES[definition.id];
  const joinedComments = comments.map(({ text }) => String(text)).join(' ');

  add('Response has the expected case_id', response.case_id === definition.id, `Expected ${definition.id}; actual ${response.case_id}.`);
  add('Response selects the expected comment mode', response.mode === expectedMode(definition), `Expected ${expectedMode(definition)}; actual ${response.mode}.`);
  add('Response uses the expected comment language', response.language === definition.expected_language, `Expected ${definition.expected_language}; actual ${response.language}.`);
  add('comment_count matches the comments array', response.comment_count === commentCount, `comment_count=${response.comment_count}; comments.length=${commentCount}.`);
  add(`Comment count satisfies ${bounds.label}`, commentCount >= bounds.min && commentCount <= bounds.max, `Actual comment count: ${commentCount}.`);
  add('Every reported comment exists in the returned code', reportedCommentsExist(language, response.code, comments), 'Compared normalized reported comments with source comment tokens.');
  add('Returned code has no unreported new comments', newSourceCommentsMatchReport(definition, language, response.code, comments), 'Compared normalized source comments with preserved input comments and the report.');
  add('Comments or external explanation use the expected language', usesExpectedLanguage(definition.expected_language, comments, response.explanation), `Expected language: ${definition.expected_language}.`);
  if (definition.should_invoke) {
    add('Write result reports the complete-change comment review', reportsCompleteReview(response.explanation), `Explanation: ${response.explanation}`);
  }

  switch (definition.id) {
    case 'java-high-value-write': {
      add('Returned Java passes structural validation', isStructurallyValid('java', response.code), 'Checked balanced delimiters and closed lexical regions without invoking a compiler.');
      const visible = codeOnly('java', response.code).code;
      const duplicate = visible.match(/try\s*\{(?<try>[\s\S]*?)\}\s*catch\s*\(\s*(?:[\w.]+\.)?DuplicateKeyException\s+(?<name>\w+)\s*\)\s*\{(?<catch>[^{}]*)\}/u);
      const handles = duplicate && /ledgerRepository\s*\.\s*save\s*\(/u.test(duplicate.groups.try) && !/\bthrow\b/u.test(duplicate.groups.catch);
      add('Code handles duplicate-key failures around the ledger save', handles, 'Checked try/save and a DuplicateKeyException catch that does not rethrow.');
      add('Code does not swallow unrelated failures', !/catch\s*\(\s*(?:[\w.]+\.)?(?:Exception|Throwable)\b/u.test(visible), 'Checked for broad Exception or Throwable catch clauses.');
      add('Comments capture the authoritative deduplication constraint', /唯一|幂等|去重/u.test(joinedComments), `Comment text: ${joinedComments}`);
      add('Comments capture duplicate, transaction, retry, or concurrency semantics', /重复|事务|重试|并发/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'c-buffer-fix': {
      add('Returned C passes structural validation', isStructurallyValid('c', response.code), 'Checked balanced delimiters and closed lexical regions without invoking a parser.');
      const visible = codeOnly('c', response.code).code;
      let reserves = /malloc\s*\(\s*(?:1025|1024\s*\+\s*1)\s*\)/u.test(visible) || /recv\s*\([^\r\n]+,\s*1023\s*,/u.test(visible);
      if (!reserves) {
        const named = visible.match(/malloc\s*\(\s*(?<name>[A-Za-z_]\w*)\s*\+\s*1\s*\)/u);
        reserves = Boolean(named && new RegExp(`recv\\s*\\([^\\r\\n]+,\\s*${named.groups.name}\\s*,`, 'u').test(visible));
      }
      add('Code reserves room for the string terminator', reserves, 'Checked allocation capacity against the receive limit.');
      const failure = visible.match(/if\s*\(\s*count\s*<\s*0\s*\)\s*\{(?<body>[^{}]*)\}/u);
      const releases = Boolean(failure && /free\s*\(\s*buffer\s*\)/u.test(failure.groups.body));
      let keepsOwnership = false;
      if (failure) {
        const successPath = visible.slice(failure.index + failure[0].length);
        keepsOwnership = /\*\s*out\s*=\s*buffer\s*;/u.test(successPath) && !/\bfree\s*\(/u.test(successPath);
      }
      add('The receive error path releases the buffer without freeing the successful result', releases && keepsOwnership, 'Checked failure cleanup and successful ownership transfer.');
      add('Comments explain both the boundary and resource ownership', /边界|越界|终止|容量/u.test(joinedComments) && /释放|资源|所有权/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'japanese-method-doc':
    case 'french-method-doc': {
      add('Returned Java method passes structural validation', isStructurallyValid('java', response.code), 'Checked balanced method structure without invoking javac.');
      const javadocs = (response.code.match(/\/\*\*/gu) ?? []).length;
      add(definition.id === 'japanese-method-doc' ? 'Code contains exactly one reported Javadoc method comment' : 'Code contains exactly one French Javadoc', comments.length === 1 && comments[0].kind === 'doc' && javadocs === 1, `comments=${commentCount}; Javadoc blocks=${javadocs}.`);
      add(definition.id === 'japanese-method-doc' ? 'Javadoc covers parameters, return value, and exceptions' : 'French Javadoc covers parameters, return value, and exceptions', /@param/u.test(response.code) && /@return/u.test(response.code) && /@throws/u.test(response.code), 'Checked @param, @return, and @throws tags.');
      break;
    }
    case 'grouped-line-comments':
    case 'english-grouped-line-comments':
    case 'japanese-grouped-line-comments': {
      const metrics = pythonMetrics(response.code);
      const reportedSpans = comments.map(({ covered_executable_lines: value }) => value).sort((a, b) => a - b);
      const derivedSpans = [...metrics.groupedSpans].sort((a, b) => a - b);
      add('Standalone Python comment count matches the report', metrics.structurallyValid && metrics.standaloneComments === commentCount, `Structure valid=${metrics.structurallyValid}; code=${metrics.standaloneComments}; reported=${commentCount}.`);
      add('GROUPED has a comment covering multiple related statements', metrics.maxGroupedSpan >= 2, `Maximum span: ${metrics.maxGroupedSpan}.`);
      add('Reported GROUPED coverage matches comment placement', isDeepStrictEqual(reportedSpans, derivedSpans), `Reported=${reportedSpans}; derived=${derivedSpans}.`);
      add('Reported independent-comment count matches the returned code', metrics.independentlyCommentedStatements === response.independently_commented_statement_count, `Parsed=${metrics.independentlyCommentedStatements}; reported=${response.independently_commented_statement_count}.`);
      add('Reported executable-statement count matches the returned code', metrics.executableStatements === response.executable_statement_count, `Parsed=${metrics.executableStatements}; reported=${response.executable_statement_count}.`);
      add('GROUPED does not degrade into per-statement commenting', metrics.executableStatements === 5 && metrics.independentlyCommentedStatements < 5, `Executable=${metrics.executableStatements}; independent=${metrics.independentlyCommentedStatements}.`);
      const semantic = definition.expected_language === 'zh-CN'
        ? /零|除/u.test(joinedComments) && /归一|缩放|比例|倒数/u.test(joinedComments)
        : definition.expected_language === 'en'
          ? /zero|divis/iu.test(joinedComments) && /normali|scale|ratio|reciprocal/iu.test(joinedComments)
          : /ゼロ|零|除/u.test(joinedComments) && /正規化|倍率|比率/u.test(joinedComments);
      add('GROUPED comments describe both semantic steps', semantic, `Comment text: ${joinedComments}`);
      const lines = response.code.split(/\r?\n/);
      const total = lines.findIndex((line) => /^\s*total\s*=/u.test(line));
      const scale = lines.findIndex((line) => /^\s*scale\s*=/u.test(line));
      add('GROUPED comments are anchored at both semantic steps', total > 0 && scale > 0 && lines[total - 1].trim().startsWith('#') && lines[scale - 1].trim().startsWith('#'), 'Checked placement before total and scale.');
      break;
    }
    case 'read-only-code-review':
      add('Read-only review does not rewrite code', response.code.trim() === definition.input_code.trim(), 'Compared the returned and input snippets.');
      add('Read-only review reports no added comments', commentCount === 0 && response.comment_count === 0, `comment_count=${response.comment_count}; comments.length=${commentCount}.`);
      add('Read-only review explains the empty-input risk', /空|empty|zero|ZeroDivision|除零|len/iu.test(response.explanation), `Explanation: ${response.explanation}`);
      add('Read-only review does not claim a completed full-diff workflow', !/(已|completed|performed).*(完整|complete|full|diff).*(审查|review)/isu.test(response.explanation), `Explanation: ${response.explanation}`);
      break;
    case 'negated-strict-write':
      add('Negated write request fixes the empty-input boundary', isStructurallyValid('python', response.code) && /^\s*if\s+not\s+values\s*:/mu.test(response.code) && /^\s*return\s+None\s*$/mu.test(response.code), 'Checked an empty-input None branch.');
      add('Negated line-by-line wording stays sparse', commentCount <= 1 && response.independently_commented_statement_count <= 1, `comments=${commentCount}; independent=${response.independently_commented_statement_count}.`);
      break;
    case 'preserve-existing-english': {
      const preserved = 'Keep retries bounded so callers receive a failure promptly.';
      add('Accurate English comment is preserved byte-for-byte', response.code.split(preserved).length - 1 === 1, 'Checked exact text and occurrence count.');
      add('Code enforces the new attempts boundary', isStructurallyValid('python', response.code) && /attempts\s*<\s*1/u.test(response.code) && /raise\s+ValueError/u.test(response.code), 'Checked attempts < 1 and ValueError.');
      break;
    }
    case 'replace-stale-comment':
      add('Stale English comment is removed', !response.code.includes('Empty input returns zero.'), 'Checked stale source text is absent.');
      add('Updated code and comment describe the None boundary', isStructurallyValid('python', response.code) && /^\s*return\s+None\s*$/mu.test(response.code) && /空|None|无值/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    case 'project-convention-english':
      add('Nearest project convention produces one English line comment', isStructurallyValid('python', response.code) && commentCount === 1 && comments[0].kind === 'line' && /retry|attempt|bound|limit|budget/iu.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    case 'react-state-sync': {
      const visible = codeOnly('typescript', response.code).code;
      const effect = visible.match(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{(?<body>[\s\S]*?)\}\s*,\s*\[\s*query\s*\]\s*\)/u);
      const synchronized = effect && /setFilter\s*\(\s*query\s*\)/u.test(effect.groups.body) && /setPage\s*\(\s*1\s*\)/u.test(effect.groups.body);
      add('React query effect synchronizes filter and page state', synchronized, 'Checked both state updates in the [query] effect.');
      add('React comment records the state-consistency boundary', commentCount === 1 && /筛选|查询|query/u.test(joinedComments) && /页|分页|page/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'self-explanatory-write': {
      const hasActive = /visibleIds\s*\([^)]*\bactive\s*:\s*boolean/u.test(response.code);
      const inactive = /if\s*\(\s*!\s*active\s*\)\s*\{?\s*return\s*\[\s*\]\s*;?/su.test(response.code);
      const filter = response.code.match(/\.filter\s*\(\s*\(?\s*(?<item>[A-Za-z_]\w*)\s*\)?\s*=>\s*(?<body>[A-Za-z_]\w*)\.visible\s*\)/u);
      const map = response.code.match(/\.map\s*\(\s*\(?\s*(?<item>[A-Za-z_]\w*)\s*\)?\s*=>\s*(?<body>[A-Za-z_]\w*)\.id\s*\)/u);
      const preservesFilter = Boolean(filter && filter.groups.item === filter.groups.body);
      const preservesMapping = Boolean(map && map.groups.item === map.groups.body);
      add('Self-explanatory write implements the active boundary', hasActive && inactive && preservesFilter && preservesMapping, 'Checked active boundary, visibility filter, and id mapping.');
      add('Self-explanatory write adds no source comments', commentCount === 0 && extractComments('typescript', response.code).length === 0, `comments=${commentCount}.`);
      add('Final review explicitly reports that no comment is needed', /((无需|不需|无.{0,20}需要|no).*(新增|添加|new|add)|(未新增|没有新增|added no)).*(注释|comment)/isu.test(response.explanation), `Explanation: ${response.explanation}`);
      break;
    }
    case 'cpp-ownership-transfer': {
      const visible = codeOnly('cpp', response.code).code;
      const fn = visible.match(/\b(?:void|std::unique_ptr\s*<\s*Session\s*>)\s+create_session\s*\(\s*\)\s*\{(?<body>[\s\S]*)\}\s*$/u);
      const start = /session\s*->\s*start\s*\(\s*\)/u.exec(visible);
      const move = /register_session\s*\(\s*std::move\s*\(\s*session\s*\)\s*\)/u.exec(visible);
      const postMove = move ? visible.slice(move.index + move[0].length) : '';
      const initialization = /auto\s+session\s*=\s*std::make_unique\s*<\s*Session\s*>\s*\(\s*\)\s*;/u.test(visible);
      const terminated = /session\s*->\s*start\s*\(\s*\)\s*;/u.test(visible) && /register_session\s*\(\s*std::move\s*\(\s*session\s*\)\s*\)\s*;/u.test(visible);
      const oneMove = (visible.match(/std::move\s*\(\s*session\s*\)/gu) ?? []).length === 1;
      add('C++ uses the session before transferring ownership', Boolean(fn && isStructurallyValid('cpp', response.code) && initialization && terminated && oneMove && start && move && start.index < move.index && !/\bsession\b/u.test(postMove)), 'Checked create_session structure, one move, ordering, and no post-move access.');
      add('C++ comment records the ownership boundary', commentCount === 1 && /所有权|move|转移/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'sql-partial-unique-index': {
      const visible = sqlWithoutComments(response.code);
      const partialUniqueIndex = /CREATE\s+UNIQUE\s+INDEX[\s\S]*?\(\s*user_id\s*\)[\s\S]*?WHERE\s+status\s*=\s*'active'/iu.test(visible);
      const structural = isStructurallyValid('sql', response.code)
        && /CREATE\s+TABLE\s+subscriptions[\s\S]*\buser_id\b[\s\S]*\bstatus\b/iu.test(visible)
        && partialUniqueIndex;
      add('SQL migration enforces one active subscription per user', structural, 'Structurally checked the table columns and partial unique index; no database engine was invoked.');
      add('SQL uses a partial unique index for active rows', partialUniqueIndex, "Checked CREATE UNIQUE INDEX(user_id) WHERE status = 'active'.");
      add('SQL comment records the concurrency invariant', commentCount === 1 && /并发|唯一|active|活跃/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'terraform-rolling-availability': {
      const visible = codeOnly('terraform', response.code).code;
      add('Terraform rolling strategy preserves available replicas', isStructurallyValid('terraform', response.code) && /^\s*max_unavailable\s*=\s*0\s*$/mu.test(visible) && /^\s*max_surge\s*=\s*1\s*$/mu.test(visible), 'Checked balanced structure, max_unavailable=0, and max_surge=1.');
      add('Terraform comment records the availability constraint', commentCount === 1 && /可用|容量|副本|滚动/u.test(joinedComments), `Comment text: ${joinedComments}`);
      break;
    }
    case 'strict-english-per-line': {
      const metrics = pythonMetrics(response.code);
      add('Returned Python contains exactly five standalone comments', metrics.structurallyValid && metrics.standaloneComments === 5 && commentCount === 5, `Structure valid=${metrics.structurallyValid}; code=${metrics.standaloneComments}; reported=${commentCount}.`);
      add('STRICT independently covers all five executable statements', metrics.executableStatements === 5 && metrics.independentlyCommentedStatements === 5 && response.independently_commented_statement_count === 5, `Executable=${metrics.executableStatements}; independent=${metrics.independentlyCommentedStatements}.`);
      add('STRICT reports the parsed executable-statement count', metrics.executableStatements === response.executable_statement_count, `Parsed=${metrics.executableStatements}; reported=${response.executable_statement_count}.`);
      add('Each STRICT comment covers one executable statement', comments.every(({ covered_executable_lines: count }) => count === 1), `Coverage=${comments.map(({ covered_executable_lines: count }) => count)}.`);
      break;
    }
    case 'json-no-comments': {
      let parsed;
      try { parsed = JSON.parse(response.code); } catch { parsed = undefined; }
      const valid = parsed !== undefined;
      const document = valid && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
      let preserved = false;
      if (document) {
        const expected = JSON.parse(definition.input_code);
        expected.feature.enabled = true;
        preserved = isDeepStrictEqual(parsed, expected);
      }
      add('Returned code is valid standard JSON', valid, valid ? 'JSON.parse succeeded.' : 'JSON.parse failed.');
      add('JSON updates enabled to true', document && parsed.feature?.enabled === true && preserved, document ? `feature.enabled=${parsed.feature?.enabled}; unrelated fields preserved=${preserved}.` : 'JSON is not the expected configuration object.');
      add('JSON contains no illegal comments', !/(?:\/\/|\/\*|^\s*#)/mu.test(response.code) && commentCount === 0 && response.json_comments_added === false, 'Checked comment markers, comments, and json_comments_added.');
      add('JSON reports no executable statements', response.executable_statement_count === 0 && response.independently_commented_statement_count === 0, `executable=${response.executable_statement_count}; independent=${response.independently_commented_statement_count}.`);
      break;
    }
    default:
      throw new Error(`Unsupported behavior case: ${definition.id}`);
  }

  return resultFor(definition.id, checks);
}
