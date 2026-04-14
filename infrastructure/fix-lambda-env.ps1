# Fixes Lambda env vars so inter-service calls use real Function URLs, not docker hostnames.
# Run this from a normal PowerShell window where `aws sts get-caller-identity` works.

$ErrorActionPreference = "Stop"
$region = "ap-southeast-1"

function Get-Url($fn) {
    $raw = aws lambda get-function-url-config --function-name $fn --query FunctionUrl --output text --region $region
    return $raw.TrimEnd("/")
}

Write-Host "Fetching Lambda Function URLs..."
$question = Get-Url "peerprep-question-service"
$user     = Get-Url "peerprep-user-service"
$history  = Get-Url "peerprep-history-service"
$ai       = Get-Url "peerprep-ai-service"

Write-Host "  QUESTION_SERVICE_URL = $question"
Write-Host "  USER_SERVICE_URL     = $user"
Write-Host "  HISTORY_SERVICE_URL  = $history"
Write-Host "  AI_SERVICE_URL       = $ai"

# Pull shared values from the current api-gateway env (so we don't wipe them)
Write-Host "`nReading shared env from peerprep-api-gateway..."
$gwEnv = aws lambda get-function-configuration --function-name peerprep-api-gateway --query Environment.Variables --output json --region $region | ConvertFrom-Json

$redisSessions = $gwEnv.REDIS_SESSIONS_HOST
$redisAuth     = $gwEnv.REDIS_AUTH_HOST
$frontend      = $gwEnv.FRONTEND_URL
$matching      = $gwEnv.MATCHING_SERVICE_URL
$collab        = $gwEnv.COLLAB_SERVICE_URL

Write-Host "  REDIS_SESSIONS_HOST  = $redisSessions"
Write-Host "  REDIS_AUTH_HOST      = $redisAuth"
Write-Host "  FRONTEND_URL         = $frontend"
Write-Host "  MATCHING_SERVICE_URL = $matching"
Write-Host "  COLLAB_SERVICE_URL   = $collab"

# Build env JSON for each Lambda
function Update-Env($fn, $vars) {
    $pairs = $vars.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
    $joined = $pairs -join ","
    $envArg = "Variables={$joined}"
    Write-Host "`nUpdating $fn ..."
    aws lambda update-function-configuration --function-name $fn --environment $envArg --region $region | Out-Null
    Write-Host "  OK"
}

$gatewayVars = [ordered]@{
    REDIS_SESSIONS_HOST  = $redisSessions
    REDIS_AUTH_HOST      = $redisAuth
    FRONTEND_URL         = $frontend
    USER_SERVICE_URL     = $user
    QUESTION_SERVICE_URL = $question
    HISTORY_SERVICE_URL  = $history
    AI_SERVICE_URL       = $ai
    MATCHING_SERVICE_URL = $matching
    COLLAB_SERVICE_URL   = $collab
}
Update-Env "peerprep-api-gateway" $gatewayVars

$historyVars = [ordered]@{
    REDIS_SESSIONS_HOST  = $redisSessions
    REDIS_AUTH_HOST      = $redisAuth
    FRONTEND_URL         = $frontend
    QUESTION_SERVICE_URL = $question
    USER_SERVICE_URL     = $user
    MATCHING_SERVICE_URL = $matching
    COLLAB_SERVICE_URL   = $collab
}
Update-Env "peerprep-history-service" $historyVars

# Other internal Lambdas that might also need service URLs (safe no-op if not used)
foreach ($fn in @("peerprep-question-service", "peerprep-user-service", "peerprep-ai-service")) {
    $vars = [ordered]@{
        REDIS_SESSIONS_HOST  = $redisSessions
        REDIS_AUTH_HOST      = $redisAuth
        FRONTEND_URL         = $frontend
        MATCHING_SERVICE_URL = $matching
        COLLAB_SERVICE_URL   = $collab
    }
    Update-Env $fn $vars
}

Write-Host "`nAll Lambdas updated. New invocations will pick up the env immediately."
