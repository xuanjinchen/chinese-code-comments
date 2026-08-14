# Node.js 跨平台与多 Agent 适配设计

## 背景

`chinese-code-comments` 当前使用 PowerShell 完成安装、卸载、测试、行为评测和真实写入 smoke，并通过 Codex 的用户级 `AGENTS.md` 实现全局自动触发。该实现仅覆盖 Windows 与 Codex，不能满足 GitHub 开源后的跨平台安装和多 Agent 使用需求。

本次改造不改变项目的唯一目标：让代码 Agent 自动生成规范、简洁、清晰的代码注释。Node.js 和多 Agent 适配器只负责分发与触发同一套注释规范，不引入调试、代码审查、技术写作或其他独立能力。

## 目标

- 将用户安装、升级、卸载、诊断以及维护者测试、校验、评测和 smoke 全部迁移到 Node.js 22+。
- 支持 Windows、macOS 和 Linux，不再依赖 PowerShell、Python 或特定语言工具链完成项目自身的确定性检查。
- 为 Codex、Claude Code、Google Gemini CLI、xAI Grok CLI、OpenCode 和 Nous Research Hermes Agent/CLI 提供正式适配器。
- 默认一次安装全部正式适配器，并允许通过 `--agent` 安装或卸载指定适配器。
- 保留单一标准 `SKILL.md`，同时兼容 Agent Skills 生态的通用安装方式。
- 保留现有 UTF-8 防护、幂等更新、多文件事务、失败回滚、非托管内容保护和完整 diff 注释审查语义。

## 非目标

- 不把 DeepSeek 等模型 API 当成独立 Agent 适配；其他 Agent 通过标准 Skill 或通用规则模板接入。
- 不新增 Hook、MCP 服务、编辑器插件或注释之外的产品能力。
- 不要求本阶段将包发布到 npm registry。
- 不保证没有安装、登录或配置对应 Agent CLI 时能够运行真实模型评测。
- 不通过符号链接实现 Skill 共享，避免 Windows 权限和不同 Agent 路径解析差异。

## 分发模型

项目同时提供两个入口。

### 完整安装入口

GitHub 仓库本身是一个包含 `bin` 字段的标准 Node CLI 包。用户无需先克隆仓库即可从 GitHub 拉取并运行完整安装器：

```bash
npx --yes github:xuanjinchen/chinese-code-comments install
```

完整安装器负责 Skill、副本管理、六个全局规则适配器、事务、升级、卸载和诊断。未来发布 npm 后，可使用更短的等价命令：

```bash
npx chinese-code-comments install
```

### Agent Skills 标准入口

仓库根目录继续保留符合 Agent Skills 开放标准的 `SKILL.md`，允许现有生态工具直接安装：

```bash
npx skills add xuanjinchen/chinese-code-comments -g --all
```

该入口只保证 Skill 可被目标 Agent 发现，不安装本项目的全局自动触发规则。README 必须明确说明：需要无提示词自动执行两阶段注释审查时，应使用完整安装入口。

## 总体架构

```text
SKILL.md                     唯一注释规范
    |
    +-- Node CLI ------------ install / uninstall / doctor
            |
            +-- 事务引擎 ---- 预检、暂存、提交、回滚、清理
            +-- 状态管理 ---- 已安装适配器和共享 Skill 引用
            +-- 策略渲染 ---- 共享规则模板和 Agent 调用表达
            +-- 适配器 ------- Codex / Claude / Gemini / Grok / OpenCode / Hermes
```

核心层只处理文件、编码、事务和托管区块，不包含 Agent 路径常量。每个适配器是声明式模块，提供标识、别名、Skill 存储组、全局规则路径、边界标记、调用表达和诊断信息。

## Skill 存储

采用混合共享策略，只保留三份必要副本：

| 存储组 | 使用者 | 默认路径 |
| --- | --- | --- |
| `agents` | Codex、Gemini、Grok、OpenCode | `~/.agents/skills/chinese-code-comments/` |
| `claude` | Claude Code | `~/.claude/skills/chinese-code-comments/` |
| `hermes` | Hermes | `~/.hermes/skills/chinese-code-comments/` |

共享存储组按已安装适配器记录引用。局部卸载 Codex 时，如果 Gemini、Grok 或 OpenCode 仍处于安装状态，不得删除 `agents` 存储组。默认无参数卸载会移除全部六个适配器和三个存储组中的托管文件。

Skill 目录中的准确非托管文件必须保留。安装器只更新本项目声明的运行时文件；卸载后仅在目录为空时删除目录。

## 正式适配器

| Agent ID | Skill 位置 | 全局自动触发规则 |
| --- | --- | --- |
| `codex` | `~/.agents/skills/` | `~/.codex/AGENTS.md` |
| `claude` | `~/.claude/skills/` | `~/.claude/CLAUDE.md` |
| `gemini` | `~/.agents/skills/` | `~/.gemini/GEMINI.md` |
| `grok` | `~/.agents/skills/` | `~/.grok/AGENTS.md` |
| `opencode` | `~/.agents/skills/` | `~/.config/opencode/AGENTS.md` |
| `hermes` | `~/.hermes/skills/` | `~/.hermes/SOUL.md` |

适配器优先遵循目标 Agent 官方支持的配置根环境变量；没有覆盖时使用用户主目录下的默认路径。测试通过注入临时主目录运行，不读写维护者的真实配置。

Hermes 没有与其他工具完全等价的用户级项目规则文件。其 `SOUL.md` 会在所有会话中加载，因此 Hermes 适配器在该文件中维护一段仅限代码注释行为的规则。Hermes 会扫描隐藏 HTML 注释，故该适配器使用可见 Markdown 起止标题；其他适配器可以继续使用唯一 HTML 托管标记。规则正文不得包含身份、人格或注释之外的行为要求。

## 全局规则模板

六个适配器共享同一份规则正文，只替换目标 Agent 加载 Skill 的表达方式和必要的边界标记。规则必须覆盖：

- 代码写入任务即使没有提示注释，也要加载 `chinese-code-comments`。
- 实现过程中记录有维护价值的关键意图，结束前审查完整 diff 和未跟踪交付文件。
- 默认简体中文，用户指定语言和项目就近规范优先。
- 默认采用高价值、克制的 `SCOPED` 注释；普通逐行请求使用 `GROUPED`，只有显式全称约束使用 `STRICT`。
- 保留准确的现有注释，只更新失真、错误或冲突的注释。
- 即使无需新增注释，最终回复也要报告已完成注释审查。

模板使用“加载名为 `chinese-code-comments` 的 Skill”作为通用语义。Codex 适配器可渲染为 `$chinese-code-comments`，其他适配器使用各自支持的调用表达。Skill 本体保持 Agent 无关，不复制六份不同逻辑。

## CLI 接口

可执行文件名为 `chinese-code-comments`，支持：

```text
chinese-code-comments install [--agent <ids>]
chinese-code-comments uninstall [--agent <ids>]
chinese-code-comments doctor [--agent <ids>]
chinese-code-comments --help
chinese-code-comments --version
```

行为约束：

- `install`、`uninstall` 和 `doctor` 未提供 `--agent` 时处理全部六个正式适配器。
- `--agent` 接受逗号分隔值和重复参数；未知、重复或空 ID 在预检阶段给出确定结果。
- `install` 同时承担首次安装和幂等升级，不额外提供 `update` 命令。
- 允许为尚未安装对应 CLI 的 Agent 预先创建配置目录。
- 用户取消或进程失败时返回非零退出码；成功和已处于目标状态均返回零。
- 帮助、诊断和错误消息说明具体 Agent 与目标路径，不输出秘密或完整用户配置内容。

## 安装状态

Node CLI 在用户目录下维护版本化状态文件，用于记录正式适配器集合、共享 Skill 存储组引用和安装器版本。状态文件本身属于同一事务。

状态只记录本项目所有权和哈希，不保存全局规则全文或用户文件备份。用户手工删除状态文件后，`doctor` 仍通过托管标记和文件哈希重建诊断；局部卸载在无法证明共享存储组无人使用时保守地保留该存储组，完整卸载仍可删除本项目声明的托管文件。

不得把通过 `npx skills` 安装的其他 Skill 纳入本项目状态。README 提醒用户不要同时用两种入口管理同一份 `chinese-code-comments` 副本；`doctor` 检测到来源或所有权不一致时给出修复建议，不静默删除文件。

## 文件与事务

每次安装或卸载按以下顺序执行：

1. 解析 Agent 集合、用户主目录、环境覆盖和所有目标路径。
2. 校验源文件存在、为不带 BOM 的有效 UTF-8，并计算期望内容。
3. 读取全部现有目标，拒绝目录占位、UTF-16、NUL、无效 UTF-8、重复标记、残缺标记和标记顺序错误。
4. 在内存中生成全部目标内容，确保预检失败没有文件系统副作用。
5. 在每个目标目录创建唯一暂存文件和必要备份。
6. 依次提交文件；任何提交失败时按相反顺序恢复已提交目标。
7. 提交状态文件后清理暂存与备份；提交后的清理失败只报告警告并保留恢复证据，不把成功安装误报为失败。

现有文件的 BOM 状态、主换行风格、末尾换行和托管区块之外的文本保持不变。新文件统一使用 UTF-8 无 BOM 和当前平台无关的 LF。每个目标目录中的暂存文件保证与目标位于同一文件系统。

Node 实现使用 `fs/promises`、`path`、`os`、`crypto`、`TextDecoder` 和 `child_process` 等标准库，不引入安装器运行时依赖。测试专用失败注入通过未公开的环境变量或内部 API 提供，不进入用户帮助。

## 卸载

卸载只移除：

- 本项目托管的 `SKILL.md`、Codex 元数据和状态文件条目。
- 各全局规则文件中的唯一托管区块。
- 删除托管文件后已经为空的 Skill 或配置目录。

包含其他内容的规则文件和 Skill 目录必须保留。重复卸载成功返回，不能把“不存在”视为错误。局部卸载只减少选中适配器及其存储组引用，不影响未选中的适配器。

## Doctor

`doctor` 不修改文件，逐个适配器报告：

- Skill 是否存在、可读、哈希是否与当前仓库版本一致。
- 全局规则文件是否存在唯一且完整的托管区块。
- 状态文件、规则和共享存储组引用是否一致。
- 对应 Agent CLI 是否能在 `PATH` 中发现，仅作信息展示，不影响安装有效性。
- 发现旧 PowerShell 安装布局时给出迁移结果或重新安装建议。

任一选中适配器不一致时返回非零状态，便于 CI 和脚本使用。

## 项目结构

目标结构如下：

```text
chinese-code-comments/
├── SKILL.md
├── package.json
├── package-lock.json
├── bin/
│   └── chinese-code-comments.js
├── src/
│   ├── cli.js
│   ├── adapters/
│   ├── installer/
│   ├── policies/
│   └── state/
├── agents/
│   └── openai.yaml
├── resources/
│   └── global-policy.md
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── eval/
│   └── fixtures/
├── evals/
│   └── evals.json
└── .github/workflows/ci.yml
```

实现完成后删除 `scripts/*.ps1` 和 `tests/*.ps1`。不保留 PowerShell 包装器，避免继续形成第二套行为和测试来源。

## 测试与维护命令

全部确定性命令通过 Node.js 执行：

```bash
npm test
npm run validate
npm run check
```

`npm test` 使用 Node 内置 `node:test` 和 `assert`，覆盖：

- Skill 契约、语言和模式分类。
- 六个适配器的默认路径、存储组和规则渲染。
- 默认全量安装、按需安装、重复安装、局部卸载、完整卸载和目录保留。
- UTF-8、BOM、LF、CRLF、NUL、UTF-16、无效编码和异常托管标记。
- 每个提交点失败、回滚失败、清理失败和共享存储组引用。
- 19 个跨语言行为案例、源码实际注释库存和禁止注释格式。

`npm run validate` 检查 Node 版本、`package.json`、CLI 帮助、Skill frontmatter、Agent Skills 结构、JSON 文件、README 命令和仓库中不存在 PowerShell 维护入口。`npm run check` 顺序运行全部不调用外部模型的确定性门禁。

GitHub Actions 使用 Node 22 在 Windows、macOS 和 Linux 运行 `npm run check`。测试只操作系统临时目录，不写入 CI 用户的真实 Agent 配置。

## 真实 Agent 评测

真实调用必须显式选择 Agent，避免默认产生模型费用：

```bash
npm run eval -- --agent codex
npm run smoke -- --agent claude
```

每个正式适配器提供自己的 headless 命令驱动和输出归一化层。`--agent` 必填；所选 CLI 缺失、未登录、命令协议变化或调用失败时直接失败，不能静默跳过。

行为评测继续覆盖现有 19 个跨语言案例，检查模式、语言、语法或结构、注释质量、源码真实注释库存和最终审查报告。smoke 在隔离的临时 Git 仓库中发送不包含“注释”字样的代码修改请求，验证：

- Agent 能发现并加载目标 Skill。
- 全局规则能在无显式提示时触发两阶段流程。
- 目标文件产生真实 diff。
- 新增注释准确、克制且符合目标语言。
- 最终回复报告完整 diff 注释审查。

真实评测不属于 `npm run check` 或默认 CI，避免凭据要求、外部服务波动和费用影响确定性门禁。

## 旧版本迁移

首次 Node 安装必须识别当前 PowerShell 版本生成的 Codex 布局和 HTML 托管标记。内容合法时直接接管并升级，不要求用户先卸载旧版本；标记残缺、重复或内容编码无效时停止并给出修复路径。

Node 版本验证通过后，仓库删除 PowerShell 源码和 README 中的 PowerShell 命令。用户机器上的旧 Skill 副本和 Codex 规则由 Node 安装器就地升级，不主动删除与本项目无关的 `.cc-switch` 或其他第三方目录。

## README 要求

README 继续采用用户优先结构，至少说明：

- Node.js 22+ 前置条件和三平台支持。
- 完整 GitHub `npx` 安装与标准 `npx skills` 安装的能力差异。
- 默认安装六个适配器以及 `--agent` 示例。
- 六个 Agent 的路径、自动触发机制和 Hermes `SOUL.md` 特殊性。
- 升级、局部卸载、完整卸载和 `doctor`。
- 确定性检查与真实 Agent 评测的费用、登录和 CLI 前置条件。
- 通用规则模板只能提供兼容入口，未经验证的 Agent 不宣称为正式支持。

## 验收标准

- 仓库的用户、测试和维护入口均不依赖 `.ps1`。
- 从 GitHub 执行完整 `npx` 命令可在三个目标平台安装、重复升级、诊断和卸载。
- 默认安装六个正式适配器，按需安装不会改动未选中的规则文件。
- 共享 Skill 在局部卸载时按引用保留，完整卸载不删除非托管内容。
- `npm run check` 在 Node 22 的 Windows、macOS 和 Linux CI 中通过。
- 六个 live runner 均能在明确选择且环境满足时执行；缺少环境时明确失败。
- `SKILL.md` 仍可由 `npx skills add` 发现和安装。
- README 不再把项目描述为 Windows 或 Codex 专用。
- 项目仍只负责自动生成、更新和审查规范、简洁、清晰的代码注释。
