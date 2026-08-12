# Chinese Code Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建、验证并全局安装 `chinese-code-comments` skill，使 Codex 在所有项目的代码写入任务中执行两阶段注释审查，同时遵循用户指定的语言和注释粒度。

**Architecture:** 仓库根目录保存可分发的 skill 源文件，`SKILL.md` 负责触发和工作流，`agents/openai.yaml` 负责 UI 与隐式调用策略。仓库内的 PowerShell 契约测试验证规则完整性，安装器只复制运行时文件到用户级 skill 目录，并使用受管标记块幂等更新全局 `AGENTS.md`；最终在隔离临时仓库中验证无需提示词的全局执行路径。

**Tech Stack:** Markdown、YAML、PowerShell 5+、Git、Codex CLI、skill-creator Python 脚本

## Global Constraints

- 对所有产生代码写入的任务执行“实现时记录关键意图 + 结束前审查完整改动”。
- 注释语言优先级固定为：用户明确指定、项目就近规范、简体中文。
- 注释基准优先级固定为：用户明确指定、项目就近规范、默认高价值维护注释。
- 默认关注业务意图、约束、边界、异常、并发、资源管理、兼容性和非直观实现。
- “逐行注释”默认按连续语义分组；只有用户明确要求“每行都要”或“一行一注”时才严格逐条注释。
- 保留准确的现有注释及其语言；仅在失真、错误或冲突时更新。
- 允许审查结论为“不需要新增注释”，但最终回复必须报告已完成审查。
- 不向标准 JSON、锁文件、生成代码、第三方依赖或不支持注释的格式写入非法注释。
- 注释修改不得改变程序逻辑、破坏语法、泄露秘密或承诺未经验证的行为。
- 按需联动相关 skill，复用当前任务已有结论，不强制重复执行所有辅助 skill。
- 第一版不引入 Hook、不创建插件、不修改无关 skill 或业务项目代码。

---

## File Map

- Create: `SKILL.md` — skill 触发描述、两阶段流程、优先级、按需联动和输出要求。
- Create: `agents/openai.yaml` — 显示名称、简短说明、默认提示和隐式调用策略。
- Create: `tests/skill-contract.tests.ps1` — 对 skill 元数据和正文关键契约进行确定性检查。
- Create: `tests/behavior-cases.json` — 跨语言、跨粒度、正向和反向行为用例。
- Create: `tests/behavior-cases.tests.ps1` — 校验行为用例的结构、覆盖范围和唯一性。
- Create: `scripts/install.ps1` — 幂等安装用户级 skill，并更新全局受管规则块。
- Create: `tests/install.tests.ps1` — 在隔离临时目录验证安装、内容保留和重复执行。
- Modify: `<user-home>\.codex\AGENTS.md` — 由安装器追加或更新全局受管规则块，不覆盖其他内容。
- Create/Update: `<user-home>\.agents\skills\chinese-code-comments\SKILL.md` — 安装后的用户级 skill。
- Create/Update: `<user-home>\.agents\skills\chinese-code-comments\agents\openai.yaml` — 安装后的 UI 和调用策略。

### Task 1: 初始化 Skill 包和调用元数据

**Files:**
- Create: `SKILL.md`
- Create: `agents/openai.yaml`

**Interfaces:**
- Consumes: 内置 `skill-creator/scripts/init_skill.py`。
- Produces: 名为 `chinese-code-comments` 的合法 skill 根目录；后续测试固定读取仓库根目录的 `SKILL.md` 和 `agents/openai.yaml`。

- [ ] **Step 1: 使用官方初始化脚本创建临时脚手架**

在仓库根目录运行：

```powershell
$skillPython = '<user-home>\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$skillCreator = '<user-home>\.codex\skills\.system\skill-creator'
$scaffoldRoot = Join-Path $env:TEMP 'chinese-code-comments-skill-scaffold'

if (Test-Path -LiteralPath $scaffoldRoot) {
    $resolvedScaffold = (Resolve-Path -LiteralPath $scaffoldRoot).Path
    $resolvedTemp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
    if (-not $resolvedScaffold.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temp path: $resolvedScaffold"
    }
    Remove-Item -LiteralPath $resolvedScaffold -Recurse -Force
}

& $skillPython "$skillCreator\scripts\init_skill.py" chinese-code-comments `
    --path $scaffoldRoot `
    --interface 'display_name=Chinese Code Comments' `
    --interface 'short_description=按任务意图和项目规范审查并编写准确、耐维护的多语言代码注释' `
    --interface 'default_prompt=Use $chinese-code-comments to review this code change and add accurate comments using the requested language and granularity.'

Copy-Item -LiteralPath "$scaffoldRoot\chinese-code-comments\SKILL.md" -Destination '.\SKILL.md'
Copy-Item -LiteralPath "$scaffoldRoot\chinese-code-comments\agents" -Destination '.\agents' -Recurse
```

Expected: 仓库根目录出现 `SKILL.md` 和 `agents/openai.yaml`，初始化命令正常退出。

- [ ] **Step 2: 将脚手架替换为无占位符的最小合法内容**

将 `SKILL.md` 写成：

```markdown
---
name: chinese-code-comments
description: 在创建、修改、重构、修复或审查任意语言代码时，添加、更新和审核准确、耐维护的代码注释；也用于用户提出中文注释、指定语言注释、逐行注释、代码块注释、方法、类或 API 文档注释等要求。对产生代码写入的任务，在实现过程中记录关键意图，并在结束前审查完整改动。默认使用简体中文，用户指定语言或项目规范优先。
---

# Chinese Code Comments

在代码创建、修改、重构、修复或审查过程中，确定注释语言和粒度，并在结束前复核本次完整改动。
```

确认 `agents/openai.yaml` 精确为：

```yaml
interface:
  display_name: "Chinese Code Comments"
  short_description: "按任务意图和项目规范审查并编写准确、耐维护的多语言代码注释"
  default_prompt: "Use $chinese-code-comments to review this code change and add accurate comments using the requested language and granularity."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 3: 使用官方校验脚本验证结构**

`quick_validate.py` 依赖 PyYAML，而当前 Codex Python 未预装该包。将依赖安装到临时目录，不写入仓库或系统 Python：

```powershell
$validatorDeps = Join-Path $env:TEMP 'chinese-code-comments-validator-deps'
& $skillPython -m pip install --disable-pip-version-check --target $validatorDeps 'PyYAML>=6,<7'
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = $validatorDeps
try {
    & $skillPython "$skillCreator\scripts\quick_validate.py" '.'
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
```

Expected: 输出 `Skill is valid!`。如果依赖下载受网络沙箱限制，使用受限网络升级重试同一安装命令，不改用未经验证的 YAML 解析方式。

- [ ] **Step 4: 检查并提交初始化结果**

```powershell
git diff --check
git add SKILL.md agents/openai.yaml
git commit -m "feat: scaffold chinese code comments skill"
```

Expected: 提交只包含两个 skill 运行时文件。

### Task 2: 用契约测试实现完整注释工作流

**Files:**
- Create: `tests/skill-contract.tests.ps1`
- Modify: `SKILL.md`

**Interfaces:**
- Consumes: Task 1 的合法 skill 元数据。
- Produces: `tests/skill-contract.tests.ps1`，退出码 `0` 表示所有静态策略契约满足；完整 `SKILL.md` 供安装器复制和 Codex 加载。

- [ ] **Step 1: 编写失败的策略契约测试**

创建 `tests/skill-contract.tests.ps1`：

```powershell
param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Match {
    param([string]$Content, [string]$Pattern, [string]$Label)
    if (-not [regex]::IsMatch($Content, $Pattern, [Text.RegularExpressions.RegexOptions]::Singleline)) {
        throw "Missing skill contract: $Label"
    }
}

$skillPath = Join-Path $RepoRoot 'SKILL.md'
$metadataPath = Join-Path $RepoRoot 'agents\openai.yaml'
if (-not (Test-Path -LiteralPath $skillPath)) { throw 'SKILL.md is missing' }
if (-not (Test-Path -LiteralPath $metadataPath)) { throw 'agents/openai.yaml is missing' }

$skill = Get-Content -Raw -Encoding UTF8 -LiteralPath $skillPath
$metadata = Get-Content -Raw -Encoding UTF8 -LiteralPath $metadataPath

$contracts = [ordered]@{
    'broad code-writing trigger' = '创建、修改、重构、修复或审查'
    'language priority' = '用户明确指定.+项目.+简体中文'
    'granularity priority' = '用户明确指定.+项目.+默认高价值维护注释'
    'implementation phase' = '实现过程中'
    'complete-change review' = '结束前.+完整改动'
    'default comment basis' = '业务意图.+约束.+边界.+异常.+并发.+资源管理.+兼容性.+非直观'
    'grouped line comments' = '逐行注释.+连续且语义一致'
    'strict per-line override' = '每行都要.+一行一注'
    'preserve accurate comments' = '保留准确的现有注释'
    'no-comment valid result' = '不需要新增注释'
    'debugging composition' = 'systematic-debugging'
    'review composition' = 'requesting-code-review'
    'writing composition' = 'technical-writer'
    'unsupported formats' = '标准 JSON.+锁文件.+生成代码.+第三方依赖'
    'behavior preservation' = '不得改变代码逻辑'
}

foreach ($entry in $contracts.GetEnumerator()) {
    Assert-Match -Content $skill -Pattern $entry.Value -Label $entry.Key
}

Assert-Match -Content $metadata -Pattern 'allow_implicit_invocation:\s*true' -Label 'implicit invocation enabled'
Assert-Match -Content $metadata -Pattern '\$chinese-code-comments' -Label 'default prompt names the skill'

$lineCount = ($skill -split "`n").Count
if ($lineCount -ge 500) { throw "SKILL.md must remain under 500 lines; actual: $lineCount" }

Write-Host 'Skill contract tests passed.'
```

- [ ] **Step 2: 运行测试并确认当前最小正文失败**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\skill-contract.tests.ps1'
```

Expected: FAIL，首个缺失项为 `language priority` 或后续策略契约；不得因为脚本语法错误失败。

- [ ] **Step 3: 将 `SKILL.md` 扩展为完整工作流**

保留 Task 1 的 frontmatter，使用以下正文：

```markdown
# Chinese Code Comments

## 解析本次注释策略

1. 先读取用户要求、当前目录最近的项目规范、现有代码与测试。
2. 按“用户明确指定、项目就近规范、简体中文”确定新增或更新注释的语言。
3. 按“用户明确指定、项目就近规范、默认高价值维护注释”确定范围、粒度和格式。
4. 保留准确的现有注释及其语言；只有注释失真、错误或与改动冲突时才更新。
5. 使用目标语言和项目惯用的行注释、块注释、docstring、Javadoc、TSDoc 或等价格式。

## 分两个阶段工作

### 实现过程中

- 在实现复杂业务规则、边界保护、异常恢复、并发控制、事务、幂等、资源清理或兼容逻辑时，同步记录关键意图。
- 默认解释业务意图、约束、边界、异常、并发、资源管理、兼容性和非直观实现。
- 不猜测无法从需求、代码、测试、文档或已确认 skill 结论验证的业务事实。
- 不逐句翻译变量赋值、普通循环或显而易见的函数调用，除非用户明确要求对应粒度。

### 结束前审查完整改动

1. 获取本次完整改动。Git 项目检查 diff 和未跟踪文件；非 Git 项目检查本次实际触及的文件。
2. 结合周边实现、测试和文档复核意图，不能只阅读新增行。
3. 查找缺失、重复、显而易见、错误和已经失真的注释。
4. 按本次语言和粒度策略新增、更新或删除注释，只处理与本次改动有关的范围。
5. 确认注释不得改变代码逻辑、破坏语法、泄露秘密或承诺未经验证的行为。
6. 运行与改动风险相称的格式化、语法检查或既定测试；已经完成的验证不无理由重复执行。
7. 在最终回复中报告注释审查结果。没有维护上下文需要记录时，明确说明已检查且不需要新增注释。

## 遵循用户指定的注释粒度

- 支持逐行注释、代码块注释、方法或函数注释、类注释、API 文档注释、参数、返回值、异常和其他自定义基准。
- 用户只要求“逐行注释”时，把连续且语义一致的简单语句合并为一条注释。
- 用户明确要求“每行都要”“一行一注”或等价表达时，为每条可执行语句分别注释，同时保持代码可编译、可解析和可格式化。
- 用户指定关注点时，只围绕该关注点补充信息，不额外扩张注释范围。

## 按需联动相关 skill

- 遇到 Bug、失败测试或异常行为时，使用 `systematic-debugging` 的根因、触发条件和防回归结论。
- 完成功能、高风险修改或合并前检查时，使用 `requesting-code-review` 识别的风险、约束和回归面。
- 涉及公共 API、复杂业务、架构或维护说明时，使用 `technical-writer` 提炼领域术语、契约和读者所需上下文。
- 前端、React、移动端、架构、测试和其他技术栈仅在对应 skill 的正常触发条件满足时联动。
- 优先复用当前任务已经得到的分析结论，不重复执行同一 skill，不把冗长分析直接复制到源码。

## 处理文件与格式边界

- 默认不修改标准 JSON、锁文件、生成代码、第三方依赖、压缩文件或不支持注释的格式。
- 用户要求的目标格式不支持注释时，不写入非法内容；根据任务范围在相邻代码、文档或最终回复中说明。
- 无法确认业务意图且错误注释风险较高时，不在源码中猜测，并在最终回复指出缺失信息。

## 保持注释可维护

- 解释稳定的原因、不变量、契约和风险，而不是记录聊天过程或短期实现历史。
- 使用最短但足以防止误解的表达，把注释放在相关声明、分支或代码块附近。
- 不用注释替代清晰命名、必要重构或正确测试。
- 代码行为变化时同步更新注释；注释失真时删除或重写。
```

- [ ] **Step 4: 运行契约和官方结构校验**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\skill-contract.tests.ps1'
$env:PYTHONPATH = Join-Path $env:TEMP 'chinese-code-comments-validator-deps'
& $skillPython "$skillCreator\scripts\quick_validate.py" '.'
```

Expected: 输出 `Skill contract tests passed.` 和 `Skill is valid!`。

- [ ] **Step 5: 提交完整工作流**

```powershell
git diff --check
git add SKILL.md tests/skill-contract.tests.ps1
git commit -m "feat: define code comment review workflow"
```

### Task 3: 增加跨语言行为用例和前向测试

**Files:**
- Create: `tests/behavior-cases.json`
- Create: `tests/behavior-cases.tests.ps1`

**Interfaces:**
- Consumes: Task 2 的 `SKILL.md` 行为契约。
- Produces: 可由人工、子代理或后续评测工具读取的行为用例数组；每条用例包含唯一 `id`、`prompt`、`should_invoke`、`expected_language`、`expected_granularity` 和 `expected_behavior`。

- [ ] **Step 1: 创建代表性行为用例**

创建 `tests/behavior-cases.json`，包含以下 10 个 `id`：

```json
[
  {"id":"java-implicit-write","prompt":"实现 Java 支付回调去重逻辑，完成后验证改动。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"结束前审查完整改动，并说明幂等、事务或重试中的非直观约束。"},
  {"id":"react-state-sync","prompt":"重构这个 React 组件的筛选条件和分页状态。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"只在状态同步、effect 或交互边界需要维护上下文时注释。"},
  {"id":"c-buffer-fix","prompt":"修复 C socket 读取中的缓冲区越界和错误路径资源泄漏。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"结合根因说明边界检查、所有权和资源释放。"},
  {"id":"japanese-method-doc","prompt":"给新增方法写日文方法注释，说明参数、返回值和异常。","should_invoke":true,"expected_language":"ja","expected_granularity":"method","expected_behavior":"采用语言惯用的方法文档格式，并覆盖参数、返回值和异常。"},
  {"id":"grouped-line-comments","prompt":"给这段代码逐行添加中文注释。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"grouped-line","expected_behavior":"连续且语义一致的简单语句合并注释。"},
  {"id":"strict-english-per-line","prompt":"Every executable line must have its own English comment.","should_invoke":true,"expected_language":"en","expected_granularity":"per-line","expected_behavior":"每条可执行语句分别使用英文注释，并保持语法有效。"},
  {"id":"preserve-existing-english","prompt":"修改实现并补充必要的中文注释；现有英文注释仍然准确。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"保留准确英文注释，不翻译；新增注释使用中文。"},
  {"id":"replace-stale-comment","prompt":"逻辑已经变化，修正与实现冲突的英文注释。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"把失真注释更新为准确中文，除非项目规范指定其他语言。"},
  {"id":"json-no-comments","prompt":"更新标准 JSON 配置并补充说明。","should_invoke":true,"expected_language":"zh-CN","expected_granularity":"default","expected_behavior":"不向标准 JSON 写入非法注释，改在允许的相邻位置或最终回复说明。"},
  {"id":"read-only-explanation","prompt":"解释这段函数为什么这样写，不修改文件。","should_invoke":false,"expected_language":"zh-CN","expected_granularity":"none","expected_behavior":"不强制执行结束前 diff 注释流程；若用户进一步要求注释，再调用 skill。"}
]
```

- [ ] **Step 2: 编写并运行用例结构测试**

创建 `tests/behavior-cases.tests.ps1`：

```powershell
param([string]$RepoRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$path = Join-Path $RepoRoot 'tests\behavior-cases.json'
$cases = @(Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json)
if ($cases.Count -ne 10) { throw "Expected 10 behavior cases; actual: $($cases.Count)" }

$ids = @($cases | ForEach-Object { $_.id })
if (($ids | Select-Object -Unique).Count -ne $ids.Count) { throw 'Behavior case ids must be unique' }

foreach ($case in $cases) {
    foreach ($field in @('id','prompt','should_invoke','expected_language','expected_granularity','expected_behavior')) {
        if ($null -eq $case.$field -or [string]::IsNullOrWhiteSpace([string]$case.$field)) {
            throw "Case $($case.id) is missing $field"
        }
    }
}

foreach ($requiredId in @('java-implicit-write','c-buffer-fix','japanese-method-doc','grouped-line-comments','strict-english-per-line','preserve-existing-english','json-no-comments','read-only-explanation')) {
    if ($ids -notcontains $requiredId) { throw "Missing behavior case: $requiredId" }
}

if (-not ($cases | Where-Object { $_.should_invoke -eq $false })) { throw 'At least one non-trigger case is required' }
Write-Host 'Behavior case tests passed.'
```

运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\behavior-cases.tests.ps1'
```

Expected: 输出 `Behavior case tests passed.`。

- [ ] **Step 3: 使用新上下文前向测试关键用例**

至少独立测试以下 6 个 `id`：`java-implicit-write`、`c-buffer-fix`、`japanese-method-doc`、`grouped-line-comments`、`strict-english-per-line`、`json-no-comments`。每次只向新代理提供仓库 skill 路径、用例 prompt 和最小代码片段，不提供预期答案；然后根据 JSON 中的 `expected_*` 字段审核输出。

通过标准：语言、粒度、注释位置和不支持格式处理全部符合预期；默认模式没有逐句翻译显而易见代码；严格逐行模式仍保持语法有效。失败时只修改 `description` 或相关工作流规则，并重新运行契约测试和失败用例。

- [ ] **Step 4: 提交行为用例**

```powershell
git diff --check
git add tests/behavior-cases.json tests/behavior-cases.tests.ps1
git commit -m "test: add cross-language comment behavior cases"
```

### Task 4: 实现并测试幂等全局安装器

**Files:**
- Create: `scripts/install.ps1`
- Create: `tests/install.tests.ps1`

**Interfaces:**
- Consumes: 仓库根目录 `SKILL.md` 和 `agents/openai.yaml`。
- Produces: `scripts/install.ps1 -SkillSource <path> -SkillsRoot <path> -GlobalAgentsFile <path>`；省略参数时安装到当前用户全局目录。

- [ ] **Step 1: 编写失败的安装测试**

创建 `tests/install.tests.ps1`：

```powershell
param([string]$RepoRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("chinese-code-comments-install-" + [guid]::NewGuid().ToString('N'))
$skillsRoot = Join-Path $testRoot '.agents\skills'
$agentsFile = Join-Path $testRoot '.codex\AGENTS.md'
$installer = Join-Path $RepoRoot 'scripts\install.ps1'

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $agentsFile) -Force | Out-Null
    [IO.File]::WriteAllText($agentsFile, "# Existing Rules`r`n`r`n- Keep this line.`r`n", [Text.UTF8Encoding]::new($false))

    & $installer -SkillSource $RepoRoot -SkillsRoot $skillsRoot -GlobalAgentsFile $agentsFile
    & $installer -SkillSource $RepoRoot -SkillsRoot $skillsRoot -GlobalAgentsFile $agentsFile

    $installedRoot = Join-Path $skillsRoot 'chinese-code-comments'
    foreach ($relative in @('SKILL.md','agents\openai.yaml')) {
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot $relative)).Hash
        $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installedRoot $relative)).Hash
        if ($sourceHash -ne $installedHash) { throw "Installed file differs: $relative" }
    }

    $content = [IO.File]::ReadAllText($agentsFile, [Text.UTF8Encoding]::new($false))
    if (-not $content.Contains('# Existing Rules')) { throw 'Existing AGENTS.md content was lost' }
    if (-not $content.Contains('- Keep this line.')) { throw 'Existing AGENTS.md rule was lost' }
    if ([regex]::Matches($content, '<!-- chinese-code-comments:start -->').Count -ne 1) { throw 'Managed block start must occur once' }
    if ([regex]::Matches($content, '<!-- chinese-code-comments:end -->').Count -ne 1) { throw 'Managed block end must occur once' }
    if (-not $content.Contains('$chinese-code-comments')) { throw 'Managed block must explicitly invoke the skill' }

    Write-Host 'Installer tests passed.'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTemp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
        if ($resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
        }
    }
}
```

- [ ] **Step 2: 运行测试并确认安装器缺失导致失败**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\install.tests.ps1'
```

Expected: FAIL，原因是 `scripts/install.ps1` 不存在。

- [ ] **Step 3: 实现安装器**

创建 `scripts/install.ps1`：

```powershell
[CmdletBinding()]
param(
    [string]$SkillSource = (Split-Path -Parent $PSScriptRoot),
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [string]$GlobalAgentsFile = (Join-Path $env:USERPROFILE '.codex\AGENTS.md')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$skillFile = Join-Path $SkillSource 'SKILL.md'
$metadataFile = Join-Path $SkillSource 'agents\openai.yaml'
if (-not (Test-Path -LiteralPath $skillFile)) { throw "Missing source file: $skillFile" }
if (-not (Test-Path -LiteralPath $metadataFile)) { throw "Missing source file: $metadataFile" }

$destination = Join-Path $SkillsRoot 'chinese-code-comments'
$destinationAgents = Join-Path $destination 'agents'
New-Item -ItemType Directory -Path $destinationAgents -Force | Out-Null
Copy-Item -LiteralPath $skillFile -Destination (Join-Path $destination 'SKILL.md') -Force
Copy-Item -LiteralPath $metadataFile -Destination (Join-Path $destinationAgents 'openai.yaml') -Force

$startMarker = '<!-- chinese-code-comments:start -->'
$endMarker = '<!-- chinese-code-comments:end -->'
$managedBlock = @'
<!-- chinese-code-comments:start -->
## Global Code Comment Policy

- 创建、修改、重构或修复代码时，必须在实现过程中记录有维护价值的关键意图，并在结束任务前显式使用 `$chinese-code-comments` 审查完整改动。
- 默认注释语言为简体中文；语言优先级为：用户明确指定、项目就近规范、简体中文。
- 默认只注释业务意图、约束、边界、异常、并发、资源管理、兼容性和非直观实现。用户明确指定注释范围、粒度或基准时，以用户要求为准。
- “逐行注释”默认按连续语义分组；只有用户明确要求“每行都要”或“一行一注”时才逐条注释。
- 保留准确的现有注释及其语言。只有注释因代码改动而失真、错误或冲突时才更新。
- 即使无需新增注释，也必须在最终回复中说明已完成注释审查。
<!-- chinese-code-comments:end -->
'@.Trim()

$agentsParent = Split-Path -Parent $GlobalAgentsFile
New-Item -ItemType Directory -Path $agentsParent -Force | Out-Null
$current = if (Test-Path -LiteralPath $GlobalAgentsFile) {
    [IO.File]::ReadAllText($GlobalAgentsFile, [Text.UTF8Encoding]::new($false))
} else {
    ''
}

$startIndex = $current.IndexOf($startMarker, [StringComparison]::Ordinal)
$endIndex = $current.IndexOf($endMarker, [StringComparison]::Ordinal)
if (($startIndex -ge 0) -xor ($endIndex -ge 0)) { throw 'Global AGENTS.md contains an incomplete chinese-code-comments block' }

if ($startIndex -ge 0) {
    $secondStart = $current.IndexOf($startMarker, $startIndex + $startMarker.Length, [StringComparison]::Ordinal)
    $secondEnd = $current.IndexOf($endMarker, $endIndex + $endMarker.Length, [StringComparison]::Ordinal)
    if ($secondStart -ge 0 -or $secondEnd -ge 0 -or $endIndex -lt $startIndex) {
        throw 'Global AGENTS.md contains duplicate or malformed chinese-code-comments markers'
    }
    $afterBlock = $endIndex + $endMarker.Length
    $next = $current.Substring(0, $startIndex) + $managedBlock + $current.Substring($afterBlock)
} else {
    $separator = if ([string]::IsNullOrWhiteSpace($current)) { '' } else { "`r`n`r`n" }
    $next = $current.TrimEnd("`r", "`n") + $separator + $managedBlock + "`r`n"
}

[IO.File]::WriteAllText($GlobalAgentsFile, $next, [Text.UTF8Encoding]::new($false))
Write-Host "Installed skill: $destination"
Write-Host "Updated global instructions: $GlobalAgentsFile"
```

- [ ] **Step 4: 运行安装器、契约和结构测试**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\install.tests.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\skill-contract.tests.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\behavior-cases.tests.ps1'
$env:PYTHONPATH = Join-Path $env:TEMP 'chinese-code-comments-validator-deps'
& $skillPython "$skillCreator\scripts\quick_validate.py" '.'
```

Expected: 三个 PowerShell 测试均通过，官方校验输出 `Skill is valid!`。

- [ ] **Step 5: 提交安装器**

```powershell
git diff --check
git add scripts/install.ps1 tests/install.tests.ps1
git commit -m "feat: add idempotent global skill installer"
```

### Task 5: 全局安装和端到端验证

**Files:**
- Modify: `<user-home>\.codex\AGENTS.md`
- Create/Update: `<user-home>\.agents\skills\chinese-code-comments\SKILL.md`
- Create/Update: `<user-home>\.agents\skills\chinese-code-comments\agents\openai.yaml`

**Interfaces:**
- Consumes: Task 4 已通过测试的 `scripts/install.ps1`。
- Produces: 所有新 Codex 会话均可发现的用户级 skill 和全局强制规则。

- [ ] **Step 1: 安装前重新读取目标状态**

```powershell
Get-Item -ErrorAction SilentlyContinue '<user-home>\.codex\AGENTS.md'
Get-Content -Raw -Encoding UTF8 -ErrorAction SilentlyContinue '<user-home>\.codex\AGENTS.md'
Get-ChildItem -Force -ErrorAction SilentlyContinue '<user-home>\.agents\skills\chinese-code-comments'
```

Expected: 记录当前内容；如果目标 skill 在实施期间已经出现，先比较内容，不覆盖无法归属的用户改动。

- [ ] **Step 2: 运行全局安装器**

从仓库根目录运行，并为写入用户目录申请明确授权：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\scripts\install.ps1'
```

Expected: 输出用户级 skill 目标路径和全局指令文件路径。

- [ ] **Step 3: 验证安装内容和幂等性**

```powershell
$installedRoot = '<user-home>\.agents\skills\chinese-code-comments'
foreach ($relative in @('SKILL.md','agents\openai.yaml')) {
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path (Get-Location) $relative)).Hash
    $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installedRoot $relative)).Hash
    if ($sourceHash -ne $installedHash) { throw "Installed file differs: $relative" }
}

powershell -NoProfile -ExecutionPolicy Bypass -File '.\scripts\install.ps1'
$globalContent = Get-Content -Raw -Encoding UTF8 -LiteralPath '<user-home>\.codex\AGENTS.md'
if ([regex]::Matches($globalContent, '<!-- chinese-code-comments:start -->').Count -ne 1) { throw 'Managed block was duplicated' }
```

Expected: 两次安装后文件哈希一致，受管规则块仍只有一份。

- [ ] **Step 4: 验证已安装 skill 结构**

```powershell
$env:PYTHONPATH = Join-Path $env:TEMP 'chinese-code-comments-validator-deps'
& $skillPython "$skillCreator\scripts\quick_validate.py" '<user-home>\.agents\skills\chinese-code-comments'
```

Expected: 输出 `Skill is valid!`。

- [ ] **Step 5: 在新 Codex 进程验证全局规则加载**

```powershell
codex -a never exec --ephemeral -s read-only -C '<repo>' `
    '概括当前生效的全局代码注释完成条件，并指出代码修改结束前必须使用的 skill。不要修改文件。'
```

Expected: 回复明确提到 `$chinese-code-comments`、实现时记录关键意图、结束前完整改动审查和“无需新增注释也要报告”。

- [ ] **Step 6: 在隔离临时仓库验证提示词不提注释时仍执行审查**

创建 `%TEMP%\chinese-code-comments-smoke` Git 仓库，只包含一个简单源文件；提示词只要求增加一个带边界分支的小功能，不提“注释”二字。运行：

```powershell
codex -a never exec --ephemeral -s workspace-write -C "$env:TEMP\chinese-code-comments-smoke" `
    -o "$env:TEMP\chinese-code-comments-smoke\last-message.txt" `
    '为现有的数值归一化函数增加空输入和上限保护，运行适当验证并完成任务。'
```

检查 `last-message.txt` 和完整 diff。通过标准：最终回复明确报告已执行 `$chinese-code-comments` 注释审查；关键边界意图需要维护上下文时有简体中文注释，代码自解释时允许不新增注释；无逐句翻译、无逻辑变化、无不相关改动。

- [ ] **Step 7: 运行最终仓库检查并记录结果**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\skill-contract.tests.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\behavior-cases.tests.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\tests\install.tests.ps1'
git diff --check
git status --short --branch
git log -5 --oneline
```

Expected: 所有测试通过，仓库工作树干净；全局安装产生的用户目录文件不进入仓库提交。最终交付说明 skill 安装路径、全局规则位置、测试结果和是否需要重启或新建 Codex 会话。
