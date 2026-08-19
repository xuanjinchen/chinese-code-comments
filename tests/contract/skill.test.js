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
  ['模式锁定', /锁定模式[\s\S]+后续不重新解释/],
  ['GROUPED 跨语言分类', /GROUPED[\s\S]+正向[\s\S]+逐行等价请求[\s\S]+line-by-line[\s\S]+一行ずつ[\s\S]+没有全称约束/],
  ['GROUPED 要求正向请求', /GROUPED[\s\S]+正向[\s\S]+否定式逐行提及[\s\S]+SCOPED/],
  ['缺少全称约束不足以触发 GROUPED', /缺少全称约束本身[\s\S]+普通[“"]添加注释[”"][\s\S]+SCOPED/],
  ['STRICT 全称分类', /STRICT[\s\S]+仅当[\s\S]+正向[\s\S]+显式[\s\S]+每一行[\s\S]+每条可执行语句[\s\S]+必须/],
  ['STRICT 要求正向请求', /STRICT[\s\S]+正向[\s\S]+否定式提及不触发/],
  ['只读审查归入 SCOPED', /SCOPED[\s\S]+纯只读任务/],
  ['实现阶段', /实现时[\s\S]+记录关键意图/],
  ['写任务完整改动审查', /代码写入任务分两阶段[\s\S]+结束前[\s\S]+完整 diff/],
  ['只读任务排除完整 diff 流程', /纯只读解释或普通代码审查不执行两阶段流程/],
  ['默认注释基准', /业务意图[\s\S]+约束[\s\S]+边界[\s\S]+异常[\s\S]+并发[\s\S]+资源管理[\s\S]+兼容性[\s\S]+非直观/],
  ['新增公共调用单元默认注释', /新增[\s\S]+公开[\s\S]+受保护[\s\S]+导出[\s\S]+函数或方法[\s\S]+声明级注释/],
  ['接口与外部契约默认注释', /接口[\s\S]+协议[\s\S]+抽象[\s\S]+HTTP[\s\S]+RPC[\s\S]+事件[\s\S]+回调[\s\S]+契约注释/],
  ['声明注释说明业务目标', /职责[\s\S]+业务处理[\s\S]+目标[\s\S]+调用方可观察/],
  ['私有声明只保留高价值注释', /私有[\s\S]+仅当[\s\S]+非直观[\s\S]+约束[\s\S]+副作用/],
  ['平凡声明豁免', /getter[\s\S]+setter[\s\S]+空构造[\s\S]+透明委托[\s\S]+测试辅助/],
  ['契约文档避免实现重复', /接口[\s\S]+声明处[\s\S]+实现[\s\S]+差异[\s\S]+不重复/],
  ['简洁清晰表达', /最短但足以防止误解[\s\S]+声明、分支或代码块附近/],
  ['GROUPED 语义块注释', /GROUPED[\s\S]+连续语义块/],
  ['STRICT 最终逐行覆盖', /STRICT[^\n]+分别覆盖每条可执行语句[^\n]+结束前补齐遗漏/],
  ['STRICT 排除结构行', /STRICT[\s\S]+else[\s\S]+catch[\s\S]+finally[\s\S]+结构行不单独注释/],
  ['保留准确注释', /保留准确的现有注释/],
  ['分散资源契约就近记录', /终止符或哨兵容量[\s\S]+失败路径释放资源[\s\S]+成功后转移所有权[\s\S]+贴近[\s\S]+分别记录[\s\S]+不能合并/],
  ['无需注释也是合法结果', /允许不新增注释/],
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
  ['显式注释请求触发', /明确要求生成、更新或审核代码注释/],
  ['普通只读任务不隐式触发', /普通只读解释或代码审查不隐式触发[\s\S]+明确审核注释除外/],
]);

for (const [label, pattern] of frontmatterContracts) {
  test(`Skill frontmatter 保留契约：${label}`, () => {
    assert.match(sections?.groups?.frontmatter ?? '', pattern);
  });
}

test('frontmatter 不重复模式算法', () => {
  assert.doesNotMatch(sections?.groups?.frontmatter ?? '', /GROUPED|STRICT/);
});

const metadataContracts = new Map([
  ['允许隐式调用', /allow_implicit_invocation:\s*true/],
  ['默认提示词显式命名 Skill', /\$chinese-code-comments/],
]);

for (const [label, pattern] of metadataContracts) {
  test(`Codex metadata 保留契约：${label}`, () => {
    assert.match(metadata, pattern);
  });
}

test('Codex metadata 不重复模式算法', () => {
  assert.doesNotMatch(metadata, /GROUPED|STRICT/);
});

const globalPolicyContracts = new Map([
  ['代码写入自动触发', /创建、修改、重构、修复[\s\S]+代码任务/],
  ['编辑前只加载一次', /编辑前加载[\s\S]+同一次加载贯穿两阶段/],
  ['实现阶段记录意图', /实现时记录关键维护意图/],
  ['结束前审查完整改动', /结束前[\s\S]+完整 diff[\s\S]+未跟踪交付文件/],
  ['只读任务例外', /纯只读解释或代码审查不强制两阶段流程[\s\S]+明确审核注释[\s\S]+检查现状/],
  ['最终报告', /无需新增注释[\s\S]+最终回复[\s\S]+报告已完成注释审查/],
]);

for (const [label, pattern] of globalPolicyContracts) {
  test(`全局策略保留契约：${label}`, () => {
    assert.match(globalPolicy, pattern);
  });
}

test('全局策略不重复模式算法', () => {
  assert.doesNotMatch(globalPolicy, /GROUPED|STRICT/);
});

test('SKILL.md 保持在 500 行以内', () => {
  assert.ok(skill.split('\n').length < 500, `实际行数：${skill.split('\n').length}`);
});
