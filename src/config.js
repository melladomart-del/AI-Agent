'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  MODEL_PROVIDER: 'local',
  LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:8080/v1',
  LOCAL_MODEL_NAME: 'qwen2.5-coder:3b',
  LOCAL_MODEL_API_KEY: 'local',
  CLOUD_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
  CLOUD_MODEL_NAME: 'openrouter/auto',
  CLOUD_MODEL_API_KEY: '',
  CLOUD_FALLBACK: 'false',
  MODEL_TEMPERATURE: '0.2',
  MODEL_MAX_TOKENS: '2048',
  MODEL_TIMEOUT_MS: '120000',
  AGENT_MAX_STEPS: '30',
  AGENT_MAX_RETRIES: '3',
  REPO_MAP_MAX_TOKENS: '1024',
  SKILL_TOP_K: '4',
  MEMORY_DIR: '.agent-memory',
  PROTECTED_PATHS: '.env,*.pem,*.key,.git/**,node_modules/**',
  BLOCKED_COMMANDS: 'rm -rf /,sudo,shutdown,reboot,mkfs',
  LOG_LEVEL: 'info',
};

function loadEnvFile(rootDir) {
  const envPath = path.join(rootDir || process.cwd(), '.env');
  const out = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  }
  return out;
}

function toList(v) {
  return String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildConfig() {
  const fromFile = loadEnvFile();
  const get = (k) => process.env[k] ?? fromFile[k] ?? DEFAULTS[k];
  return {
    provider: get('MODEL_PROVIDER'),
    local: {
      baseUrl: get('LOCAL_MODEL_BASE_URL'),
      model: get('LOCAL_MODEL_NAME'),
      apiKey: get('LOCAL_MODEL_API_KEY'),
    },
    cloud: {
      baseUrl: get('CLOUD_MODEL_BASE_URL'),
      model: get('CLOUD_MODEL_NAME'),
      apiKey: get('CLOUD_MODEL_API_KEY'),
    },
    cloudFallback: get('CLOUD_FALLBACK') === 'true',
    temperature: Number(get('MODEL_TEMPERATURE')),
    maxTokens: Number(get('MODEL_MAX_TOKENS')),
    timeoutMs: Number(get('MODEL_TIMEOUT_MS')),
    maxSteps: Number(get('AGENT_MAX_STEPS')),
    maxRetries: Number(get('AGENT_MAX_RETRIES')),
    repoMapMaxTokens: Number(get('REPO_MAP_MAX_TOKENS')),
    skillTopK: Number(get('SKILL_TOP_K')),
    memoryDir: get('MEMORY_DIR'),
    protectedPaths: toList(get('PROTECTED_PATHS')),
    blockedCommands: toList(get('BLOCKED_COMMANDS')),
    logLevel: get('LOG_LEVEL'),
    rootDir: get('AGENT_ROOT_DIR') || process.cwd(),
  };
}

module.exports = { buildConfig, DEFAULTS };
