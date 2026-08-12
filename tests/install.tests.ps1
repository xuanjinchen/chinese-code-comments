param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("chinese-code-comments-install-" + [guid]::NewGuid().ToString('N'))
$installer = Join-Path $RepoRoot 'scripts\install.ps1'

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Content, $script:utf8NoBom)
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Label)

    if ($Expected -ne $Actual) {
        throw "$Label. Expected: '$Expected'; actual: '$Actual'"
    }
}

function Assert-Match {
    param([string]$Content, [string]$Pattern, [string]$Label)

    if (-not [regex]::IsMatch($Content, $Pattern, [Text.RegularExpressions.RegexOptions]::Singleline)) {
        throw "Missing installer contract: $Label"
    }
}

function Assert-Utf8WithoutBom {
    param([string]$Path)

    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "File must use UTF-8 without BOM: $Path"
    }

    # Strict decoding rejects local-codepage and malformed UTF-8 output.
    $strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
    [void]$strictUtf8.GetString($bytes)
}

function ConvertFrom-Utf8Base64 {
    param([string]$Value)

    return $script:utf8NoBom.GetString([Convert]::FromBase64String($Value))
}

function Invoke-TestInstaller {
    param([string]$CaseRoot, [string]$AgentsFile)

    & $script:installer `
        -SkillSource $script:RepoRoot `
        -SkillsRoot (Join-Path $CaseRoot '.agents\skills') `
        -GlobalAgentsFile $AgentsFile
}

function Assert-MalformedMarkersRejected {
    param([string]$CaseName, [string]$AgentsContent)

    $caseRoot = Join-Path $script:testRoot $CaseName
    $agentsFile = Join-Path $caseRoot '.codex\AGENTS.md'
    Write-Utf8NoBom -Path $agentsFile -Content $AgentsContent
    $before = [IO.File]::ReadAllBytes($agentsFile)

    $rejected = $false
    try {
        Invoke-TestInstaller -CaseRoot $caseRoot -AgentsFile $agentsFile
    } catch {
        $rejected = $true
    }

    if (-not $rejected) {
        throw "Installer must reject malformed managed markers: $CaseName"
    }

    # Invalid markers must not leave a partial install or rewrite user rules.
    $after = [IO.File]::ReadAllBytes($agentsFile)
    Assert-Equal -Expected ([Convert]::ToBase64String($before)) -Actual ([Convert]::ToBase64String($after)) -Label "Malformed AGENTS.md was modified: $CaseName"

    $installedRoot = Join-Path $caseRoot '.agents\skills\chinese-code-comments'
    if (Test-Path -LiteralPath $installedRoot) {
        throw "Malformed AGENTS.md must not create the skill destination: $CaseName"
    }
}

if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Installer is missing: $installer"
}

try {
    $defaultSourceCaseRoot = Join-Path $testRoot 'default-source'
    $defaultSourceSkillsRoot = Join-Path $defaultSourceCaseRoot '.agents\skills'
    $defaultSourceAgentsFile = Join-Path $defaultSourceCaseRoot '.codex\AGENTS.md'

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer `
        -SkillsRoot $defaultSourceSkillsRoot `
        -GlobalAgentsFile $defaultSourceAgentsFile
    if ($LASTEXITCODE -ne 0) {
        throw "Installer without -SkillSource failed with exit code $LASTEXITCODE"
    }

    $defaultSourceInstalledRoot = Join-Path $defaultSourceSkillsRoot 'chinese-code-comments'
    foreach ($relative in @('SKILL.md', 'agents\openai.yaml')) {
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $RepoRoot $relative)).Hash
        $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $defaultSourceInstalledRoot $relative)).Hash
        Assert-Equal -Expected $sourceHash -Actual $installedHash -Label "Default SkillSource installed the wrong file: $relative"
    }

    $caseRoot = Join-Path $testRoot 'idempotent'
    $skillsRoot = Join-Path $caseRoot '.agents\skills'
    $agentsFile = Join-Path $caseRoot '.codex\AGENTS.md'
    $existingContent = "# Existing Rules`r`n`r`n- Keep this line.`r`n"
    Write-Utf8NoBom -Path $agentsFile -Content $existingContent

    Invoke-TestInstaller -CaseRoot $caseRoot -AgentsFile $agentsFile
    $firstAgentsHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $agentsFile).Hash
    Invoke-TestInstaller -CaseRoot $caseRoot -AgentsFile $agentsFile
    $secondAgentsHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $agentsFile).Hash
    Assert-Equal -Expected $firstAgentsHash -Actual $secondAgentsHash -Label 'Repeated installation changed AGENTS.md bytes'

    $installedRoot = Join-Path $skillsRoot 'chinese-code-comments'
    $expectedFiles = @('agents\openai.yaml', 'SKILL.md')
    $actualFiles = @(
        Get-ChildItem -LiteralPath $installedRoot -Recurse -File |
            ForEach-Object { $_.FullName.Substring($installedRoot.Length + 1) } |
            Sort-Object
    )
    Assert-Equal -Expected ($expectedFiles -join '|') -Actual ($actualFiles -join '|') -Label 'Installer copied an unexpected file set'

    foreach ($relative in @('SKILL.md', 'agents\openai.yaml')) {
        $sourcePath = Join-Path $RepoRoot $relative
        $installedPath = Join-Path $installedRoot $relative
        $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash
        $installedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedPath).Hash
        Assert-Equal -Expected $sourceHash -Actual $installedHash -Label "Installed file differs: $relative"
        Assert-Utf8WithoutBom -Path $installedPath
    }

    Assert-Utf8WithoutBom -Path $agentsFile
    $content = [IO.File]::ReadAllText($agentsFile, $utf8NoBom)
    if (-not $content.StartsWith($existingContent, [StringComparison]::Ordinal)) {
        throw 'Existing AGENTS.md content was not preserved byte-for-byte at the beginning'
    }
    Assert-Equal -Expected 1 -Actual ([regex]::Matches($content, '<!-- chinese-code-comments:start -->').Count) -Label 'Managed block start marker count is invalid'
    Assert-Equal -Expected 1 -Actual ([regex]::Matches($content, '<!-- chinese-code-comments:end -->').Count) -Label 'Managed block end marker count is invalid'

    Assert-Match -Content $content -Pattern '\$chinese-code-comments' -Label 'explicit skill invocation'
    # Base64 keeps this no-BOM test script compatible with Windows PowerShell 5.1.
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 'R1JPVVBFRC4r6YCQ6KGMLitTVFJJQ1QuK+avj+ihjOmDveimgS4r5LiA6KGM5LiA5rOo') -Label 'GROUPED and STRICT classification'
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 '6buY6K6kLivnroDkvZPkuK3mloc=') -Label 'default Simplified Chinese'
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 '5Lia5Yqh5oSP5Zu+LivnuqbmnZ8uK+i+ueeVjC4r5byC5bi4Livlubblj5EuK+i1hOa6kOeuoeeQhi4r5YW85a655oCnLivpnZ7nm7Top4I=') -Label 'high-value comment basis'
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 '5L+d55WZ5YeG56Gu55qE546w5pyJ5rOo6YeK') -Label 'preserve accurate existing comments'
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 '57uT5p2f5YmNLivlrozmlbQgZGlmZi4r5a6h5p+l') -Label 'complete diff review before completion'
    Assert-Match -Content $content -Pattern (ConvertFrom-Utf8Base64 '5peg6ZyA5paw5aKe5rOo6YeKLivmiqXlkYo=') -Label 'report review even without new comments'

    Assert-MalformedMarkersRejected -CaseName 'missing-end' -AgentsContent "# Existing`r`n<!-- chinese-code-comments:start -->`r`n"
    Assert-MalformedMarkersRejected -CaseName 'missing-start' -AgentsContent "# Existing`r`n<!-- chinese-code-comments:end -->`r`n"
    $duplicateMarkers = "<!-- chinese-code-comments:start -->`r`nold`r`n<!-- chinese-code-comments:end -->`r`n<!-- chinese-code-comments:start -->`r`nduplicate`r`n<!-- chinese-code-comments:end -->`r`n"
    Assert-MalformedMarkersRejected -CaseName 'duplicate' -AgentsContent $duplicateMarkers
    $wrongOrderMarkers = "<!-- chinese-code-comments:end -->`r`nold`r`n<!-- chinese-code-comments:start -->`r`n"
    Assert-MalformedMarkersRejected -CaseName 'wrong-order' -AgentsContent $wrongOrderMarkers

    Write-Host 'Installer tests passed.'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
        $resolvedTemp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
        if (-not $resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove non-temp test path: $resolvedTestRoot"
        }
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
