export class OperationRegistry {
  constructor() {
    this.operations = new Map();
  }

  start(scopeId, operationId) {
    this.operations.set(scopeId, operationId);
  }

  isCurrent(scopeId, operationId) {
    return this.operations.get(scopeId) === operationId;
  }

  clear(scopeId, operationId) {
    if (this.isCurrent(scopeId, operationId)) this.operations.delete(scopeId);
  }

  remove(scopeId) {
    this.operations.delete(scopeId);
  }
}
