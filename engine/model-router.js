const ProviderRouter = require('../providers/router');

class ModelRouter {
  constructor() {
    this.router = new ProviderRouter();

    this.local = {
      provider: 'local',
      model: process.env.LOCAL_MODEL || 'qwen2.5-coder:3b'
    };

    this.cloud = {
      provider: process.env.AI_PROVIDER || 'gemini',
      model: process.env.AI_MODEL || 'gemini-2.5-flash'
    };
  }

  choose(request) {
    const text = String(request || '').toLowerCase();

    const simplePatterns = [
      /liste/,
      /lis /,
      /ouvre/,
      /regarde/,
      /montre/,
      /cherche/,
      /trouve/,
      /explique/,
      /résume/,
      /resume/,
      /qu'est-ce/,
      /quel est/,
      /où est/,
      /ou est/
    ];

    const complexPatterns = [
      /crée/,
      /cree/,
      /construis/,
      /développe/,
      /developpe/,
      /application/,
      /frontend/,
      /backend/,
      /api/,
      /base de données/,
      /database/,
      /refactor/,
      /architecture/,
      /debug/,
      /corrige/,
      /implémente/,
      /implemente/
    ];

    if (complexPatterns.some((pattern) => pattern.test(text))) {
      return {
        ...this.cloud,
        reason: 'complex_task'
      };
    }

    if (simplePatterns.some((pattern) => pattern.test(text))) {
      return {
        ...this.local,
        reason: 'simple_task'
      };
    }

    return {
      ...this.local,
      reason: 'local_default'
    };
  }

  async getProvider(request, options = {}) {
    if (options.provider) {
      return {
        provider: this.router.get(options.provider),
        providerName: options.provider,
        model: options.model || this.local.model,
        reason: 'forced'
      };
    }

    const selected = this.choose(request);

    try {
      return {
        provider: this.router.get(selected.provider),
        providerName: selected.provider,
        model: selected.model,
        reason: selected.reason
      };
    } catch {
      return {
        provider: this.router.get(this.local.provider),
        providerName: this.local.provider,
        model: this.local.model,
        reason: 'cloud_unavailable'
      };
    }
  }
}

module.exports = ModelRouter;
