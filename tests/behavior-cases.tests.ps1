param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$path = Join-Path $RepoRoot 'tests\behavior-cases.json'
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw 'tests/behavior-cases.json is missing'
}

$parsedCases = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
$cases = @($parsedCases)
if ($cases.Count -ne 10) {
    throw "Expected 10 behavior cases; actual: $($cases.Count)"
}

$requiredFields = @(
    'id',
    'prompt',
    'should_invoke',
    'expected_language',
    'expected_granularity',
    'expected_behavior'
)
$stringFields = @(
    'id',
    'prompt',
    'expected_language',
    'expected_granularity',
    'expected_behavior'
)

foreach ($case in $cases) {
    $propertyNames = @($case.PSObject.Properties.Name)
    foreach ($field in $requiredFields) {
        if ($propertyNames -notcontains $field) {
            throw "Behavior case is missing required field: $field"
        }
    }

    foreach ($field in $stringFields) {
        if (-not ($case.$field -is [string]) -or [string]::IsNullOrWhiteSpace($case.$field)) {
            throw "Case '$($case.id)' must provide a non-empty string for $field"
        }
    }

    if (-not ($case.should_invoke -is [bool])) {
        throw "Case '$($case.id)' must provide a Boolean should_invoke value"
    }
}

$ids = @($cases | ForEach-Object { $_.id })
if (($ids | Select-Object -Unique).Count -ne $ids.Count) {
    throw 'Behavior case ids must be unique'
}

$expectedCoverage = [ordered]@{
    'java-implicit-write' = @($true, 'zh-CN', 'default')
    'react-state-sync' = @($true, 'zh-CN', 'default')
    'c-buffer-fix' = @($true, 'zh-CN', 'default')
    'japanese-method-doc' = @($true, 'ja', 'method')
    'grouped-line-comments' = @($true, 'zh-CN', 'grouped-line')
    'strict-english-per-line' = @($true, 'en', 'per-line')
    'preserve-existing-english' = @($true, 'zh-CN', 'default')
    'replace-stale-comment' = @($true, 'zh-CN', 'default')
    'json-no-comments' = @($true, 'zh-CN', 'default')
    'read-only-explanation' = @($false, 'zh-CN', 'none')
}

foreach ($entry in $expectedCoverage.GetEnumerator()) {
    $matchingCases = @($cases | Where-Object { $_.id -eq $entry.Key })
    if ($matchingCases.Count -ne 1) {
        throw "Expected exactly one behavior case: $($entry.Key)"
    }

    $case = $matchingCases[0]
    $expectedInvoke, $expectedLanguage, $expectedGranularity = $entry.Value
    if ($case.should_invoke -ne $expectedInvoke) {
        throw "Case '$($entry.Key)' has incorrect should_invoke coverage"
    }
    if ($case.expected_language -ne $expectedLanguage) {
        throw "Case '$($entry.Key)' has incorrect language coverage"
    }
    if ($case.expected_granularity -ne $expectedGranularity) {
        throw "Case '$($entry.Key)' has incorrect granularity coverage"
    }
}

Write-Host 'Behavior case tests passed.'
