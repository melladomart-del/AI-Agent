'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  MODEL_PROVIDER: 'local',
  LOCAL_MODEL_BASE_URL: 'http://127.0.0.1:8080/v1',
  // Generic model id for an OpenAI-compatible LOCAL server (llama.cpp, LM
  // Studio, vLLM, ...). This is NOT an Ollama `name:tag` (no colon): it must
  // match whatever model id the local server exposes. Set LOCAL_MODEL_NAME to
  // your server's model id (e.g. the GGUF filename for llama.cpp, or the alias
  // you configured). Ollama is an optional compatibility backend, never the
  // default execution path.
  LOCAL_MODEL_NAME: 'qwen2.5-coder-1.5b-instruct',
  LOCAL_MODEL_API_KEY: 'local',
  CLOUD_MODEL_BASE_URL: 'https://openrouter.ai/api/v1',
  CLOUD_MODEL_NAME: 'openrouter/auto',
  CLOUD_MODEL_API_KEY: '',
  CLOUD_FALLBACK: 'false',
  MODEL_TEMPERATURE: '0.2',
  MODEL_MAX_TOKENS: '2048',
  MODEL_TIMEOUT_MS: '120000',
  PROVIDER_RETRIES: '1',
  PROVIDER_RETRY_BACKOFF_MS: '750',
  OBSERVATION_MAX_CHARS: '6000',
  AGENT_MAX_STEPS: '30',
  AGENT_MAX_RETRIES: '3',
  REPO_MAP_MAX_TOKENS: '1024',
  SKILL_TOP_K: '4',
  MEMORY_DIR: '.agent-memory',
  PROTECTED_PATHS: '.env,*.pem,*.key,.git/**,node_modules/**',
  BLOCKED_COMMANDS: 'rm -rf /,sudo,shutdown,reboot,mkfs',
  LOG_LEVEL: 'info',
  RUNTIME_DIR: '.agent-runtime',
  MODEL_START_CMD: '',
  MODEL_START_ARGS: '',
  // When MODEL_START_CMD is empty, `go` can still auto-start the model server
  // if LLAMA_BIN (or an auto-detected `llama`/`llama-server` on PATH /
  // ~/.local/bin/llama) AND MODEL_PATH (a .gguf file) are available. The start
  // command is then built as: <llama> serve -m <model> --port <port> -c <ctx>.
  MODEL_PATH: '',
  LLAMA_BIN: '',
  // llama.cpp server context size (-c) and host, used when auto-building.
  LLAMA_CONTEXT: '4096',
  LLAMA_HOST: '127.0.0.1',
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

/**
 * Resolve the project root: the directory containing package.json, searched
 * upward from the given start dir (default cwd). Falls back to cwd. This lets
 * the launcher and tools locate `.env`/`skills`/config regardless of where the
 * process was invoked from.
 */
function projectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir || process.cwd());
}

function buildConfig(opts = {}) {
  const root = opts.rootDir || projectRoot();
  const fromFile = loadEnvFile(root);
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
    providerRetries: Number(get('PROVIDER_RETRIES')),
    retryBackoffMs: Number(get('PROVIDER_RETRY_BACKOFF_MS')),
    observationMaxChars: Number(get('OBSERVATION_MAX_CHARS')),
    maxSteps: Number(get('AGENT_MAX_STEPS')),
    maxRetries: Number(get('AGENT_MAX_RETRIES')),
    repoMapMaxTokens: Number(get('REPO_MAP_MAX_TOKENS')),
    skillTopK: Number(get('SKILL_TOP_K')),
    memoryDir: get('MEMORY_DIR'),
    protectedPaths: toList(get('PROTECTED_PATHS')),
    blockedCommands: toList(get('BLOCKED_COMMANDS')),
    logLevel: get('LOG_LEVEL'),
    rootDir: get('AGENT_ROOT_DIR') || root,
    runtimeDir: get('RUNTIME_DIR'),
    modelStartCmd: get('MODEL_START_CMD'),
    modelStartArgs: get('MODEL_START_ARGS'),
    modelPath: get('MODEL_PATH'),
    llamaBin: get('LLAMA_BIN'),
    llamaContext: get('LLAMA_CONTEXT'),
    llamaHost: get('LLAMA_HOST'),
  };
}

module.exports = { buildConfig, projectRoot, DEFAULTS };
