# Changelog

All notable changes to this project are documented in this file.

## [0.2.0](https://github.com/xuanjinchen/chinese-code-comments/compare/v0.1.1...v0.2.0) (2026-08-19)


### Features

* add contract-oriented declaration comments ([#9](https://github.com/xuanjinchen/chinese-code-comments/issues/9)) ([1d37fcb](https://github.com/xuanjinchen/chinese-code-comments/commit/1d37fcb83bd4cd86adddef61d25445ce45224cd1))


### Bug Fixes

* harden installer and release maintenance ([#7](https://github.com/xuanjinchen/chinese-code-comments/issues/7)) ([f572664](https://github.com/xuanjinchen/chinese-code-comments/commit/f572664cf87dba7e22026054b9421bf214e80763))
* keep release install links current ([fd4df2c](https://github.com/xuanjinchen/chinese-code-comments/commit/fd4df2c4d059528d0318635bcce331c67e768b79))
* preserve compact eval counting semantics ([2e247e0](https://github.com/xuanjinchen/chinese-code-comments/commit/2e247e0d037bbc82ea34f49a775fa2fd9f8c7fa1))


### Performance Improvements

* add core live eval profile ([6d90623](https://github.com/xuanjinchen/chinese-code-comments/commit/6d9062354b9141c22572c4845c6d517393166c11))
* compact live eval protocol ([68c55e1](https://github.com/xuanjinchen/chinese-code-comments/commit/68c55e12935f0f79e5842b1b3f0e84545dac33dc))
* reduce runtime prompt payload ([e956fca](https://github.com/xuanjinchen/chinese-code-comments/commit/e956fca14a8cfe958dd7518fa0ceb6b3ab2b028d))

## [0.1.1](https://github.com/xuanjinchen/chinese-code-comments/compare/v0.1.0...v0.1.1) (2026-08-14)


### Bug Fixes

* derive release asset names from package version ([54af1b8](https://github.com/xuanjinchen/chinese-code-comments/commit/54af1b8bd4d8b5dd683326e0a14521b044240880))
* preserve portable line endings in Git checkouts ([4026cea](https://github.com/xuanjinchen/chinese-code-comments/commit/4026cea841520b6effa97caee5970e722303dfcd))

## [0.1.0](https://github.com/xuanjinchen/chinese-code-comments/releases/tag/v0.1.0) (2026-08-14)

### Features

- 提供面向代码写入任务的自动注释策略，默认生成规范、简洁、清晰的中文高价值注释，并支持用户指定语言和粒度。
- 正式适配 Codex、Claude Code、Gemini CLI、Grok CLI、OpenCode 和 Hermes Agent/CLI，同时提供通用规则模板。
- 提供基于 Node.js 的跨平台安装、卸载和健康检查命令，支持共享 Skill、所有权状态、安全迁移和保守卸载。
- 提供确定性行为测试、真实语言语法验证和 Java 并发 smoke 验证，约束 Skill 自动触发与完整 diff 注释审查。
