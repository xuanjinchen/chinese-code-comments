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
