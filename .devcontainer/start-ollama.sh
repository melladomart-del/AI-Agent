#!/bin/bash
set -e

if ! pgrep -x ollama >/dev/null 2>&1; then
  nohup ollama serve > /tmp/ollama.log 2>&1 &
fi

for i in {1..30}; do
  if curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
    break
  fi
  sleep 1
done

curl -sf http://127.0.0.1:11434/api/tags >/dev/null || {
  echo "Ollama n'est pas disponible."
  cat /tmp/ollama.log 2>/dev/null || true
  exit 1
}

if ! ollama list | grep -q '^qwen2.5-coder:3b'; then
  ollama pull qwen2.5-coder:3b
fi

echo "Ollama prêt avec qwen2.5-coder:3b"
