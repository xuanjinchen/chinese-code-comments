import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skill = readFileSync(resolve(repoRoot, 'SKILL.md'), 'utf8');
const metadata = readFileSync(resolve(repoRoot, 'agents', 'openai.yaml'), 'utf8');
const globalPolicy = readFileSync(resolve(repoRoot, 'resources', 'global-policy.md'), 'utf8');
const sections = skill.match(/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\r?\n(?<body>[\s\S]*)$/);

test('SKILL.md 包含 YAML frontmatter 和正文', () => {
  assert.ok(sections);
});

const bodyContracts = new Map([
  ['语言优先级', /用户明确指定[\s\S]+项目[\s\S]+简体中文/],
  ['粒度优先级', /用户明确指定[\s\S]+项目[\s\S]+默认高价值维护注释/],
  ['模式锁定', /锁定注释模式[\s\S]+不得重新解释/],
  ['GROUPED 跨语言分类', /GROUPED[\s\S]+当且仅当[\s\S]+任何语言[\s\S]+逐行等价要求[\s\S]+未包含[\s\S]+全称约束[\s\S]+line-by-line[\s\S]+一行ずつ/],
  ['GROUPED 要求正向请求', /GROUPED[\s\S]+正向[\s\S]+逐行[\s\S]+否定[\s\S]+不能触发/],
  ['缺少全称约束不足以触发 GROUPED', /缺少全称约束[\s\S]+不是[\s\S]+GROUPED[\s\S]+触发条件[\s\S]+添加注释[\s\S]+补充说明[\s\S]+SCOPED/],
  ['STRICT 全称分类', /STRICT[\s\S]+当且仅当[\s\S]+显式[\s\S]+全称约束[\s\S]+每一行[\s\S]+每条[\s\S]+必须/],
  ['STRICT 要求正向请求', /STRICT[\s\S]+正向[\s\S]+否定[\s\S]+不能触发/],
  ['只读审查归入 SCOPED', /纯只读[\s\S]+审查[\s\S]+SCOPED/],
  ['实现阶段', /实现过程中/],
  ['写任务完整改动审查', /产生代码写入[\s\S]+结束前[\s\S]+完整改动/],
  ['只读任务排除完整 diff 流程', /纯只读[\s\S]*解释[\s\S]*代码审查[\s\S]*不强制[\s\S]*完整[\s\S]*diff/],
  ['默认注释基准', /业务意图[\s\S]+约束[\s\S]+边界[\s\S]+异常[\s\S]+并发[\s\S]+资源管理[\s\S]+兼容性[\s\S]+非直观/],
  ['GROUPED 语义块注释', /逐行注释[\s\S]+连续且语义一致/],
  ['STRICT 逐行覆盖', /每一行都必须[\s\S]+每条可执行语句都必须/],
  ['STRICT 排除结构行', /STRICT[\s\S]+else[\s\S]+catch[\s\S]+finally[\s\S]+结构行[\s\S]*不单独添加注释/],
  ['保留准确注释', /保留准确的现有注释/],
  ['分散资源契约就近记录', /失败路径释放资源[\s\S]+成功后转移所有权[\s\S]+分别贴近记录[\s\S]+不能合并/],
  ['无需注释也是合法结果', /不需要新增注释/],
  ['按需联动 systematic-debugging', /systematic-debugging/],
  ['按需联动 requesting-code-review', /requesting-code-review/],
  ['按需联动 technical-writer', /technical-writer/],
  ['不修改不支持注释的格式', /标准 JSON[\s\S]+锁文件[\s\S]+生成代码[\s\S]+第三方依赖/],
  ['注释不得改变行为', /不得改变代码逻辑/],
]);

for (const [label, pattern] of bodyContracts) {
  test(`Skill 正文保留契约：${label}`, () => {
    assert.match(sections?.groups?.body ?? '', pattern);
  });
}

const frontmatterContracts = new Map([
  ['代码写入触发', /description:[\s\S]+创建[\s\S]+修改[\s\S]+重构[\s\S]+修复[\s\S]+代码/],
  ['显式注释审查触发', /明确要求[\s\S]*审查代码注释/],
  ['跨语言 GROUPED 分类', /任何语言[\s\S]+逐行等价请求[\s\S]+line-by-line[\s\S]+一行ずつ[\s\S]+全称约束/],
  ['仅写任务执行完整 diff', /产生代码写入[\s\S]+完整 diff[\s\S]+纯只读[\s\S]+代码审查[\s\S]+不强制/],
]);

for (const [label, pattern] of frontmatterContracts) {
  test(`Skill frontmatter 保留契约：${label}`, () => {
    assert.match(sections?.groups?.frontmatter ?? '', pattern);
  });
}

test('frontmatter 不把任意只读代码审查设为隐式触发', () => {
  assert.doesNotMatch(sections?.groups?.frontmatter ?? '', /审查任意语言代码/);
});

const metadataContracts = new Map([
  ['允许隐式调用', /allow_implicit_invocation:\s*true/],
  ['默认提示词显式命名 Skill', /\$chinese-code-comments/],
  ['默认提示词保留跨语言模式分类', /GROUPED[\s\S]+line-by-line[\s\S]+一行ずつ[\s\S]+STRICT[\s\S]+universal/],
  ['默认提示词要求正向逐行请求', /GROUPED[\s\S]+requires[\s\S]+positive[\s\S]+merely lacking[\s\S]+not enough[\s\S]+negated[\s\S]+SCOPED/],
  ['默认提示词排除否定式全称请求', /STRICT[\s\S]+affirmative[\s\S]+negated[\s\S]+SCOPED/],
  ['默认提示词仅对写入执行完整 diff', /write[\s\S]+full diff[\s\S]+read-only[\s\S]+does not require/i],
]);

for (const [label, pattern] of metadataContracts) {
  test(`Codex metadata 保留契约：${label}`, () => {
    assert.match(metadata, pattern);
  });
}

test('全局策略要求显式执行完整 diff 注释审查', () => {
  assert.match(globalPolicy, /(?:\$chinese-code-comments|\{\{skill_invocation\}\})[\s\S]+完整 diff/);
});

test('全局策略排除否定式 STRICT 触发', () => {
  assert.match(globalPolicy, /否定式全称提及不能触发\s*`?STRICT`?[\s\S]+`?SCOPED`?/);
});

test('SKILL.md 保持在 500 行以内', () => {
  assert.ok(skill.split('\n').length < 500, `实际行数：${skill.split('\n').length}`);
});
