'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Base class for tools. Subclasses implement `run(args)` and declare a
 * `schema` (OpenAI function-calling format) and a `permissions` object.
 *
 * `permissions: { write: true, destructive: true }` lets the safety layer and
 * a UI prompt appropriately. The engine never calls `run` directly; it goes
 * through the registry which applies safety checks.
 */
class Tool {
  constructor(opts) {
    this.name = opts.name;
    this.description = opts.description;
    this.parameters = opts.parameters;
    this.permissions = opts.permissions || {};
    this.handler = opts.handler || this.run.bind(this);
  }

  async run(/* args */) {
    throw new Error(`Tool ${this.name} did not implement run()`);
  }

  /** OpenAI function-calling schema for this tool. */
  getSchema() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

module.exports = { Tool };
