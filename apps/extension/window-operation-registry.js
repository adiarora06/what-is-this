export class WindowOperationRegistry {
  constructor() {
    this.operations = new Map();
  }

  start(windowId, operationId) {
    this.operations.set(windowId, operationId);
  }

  isCurrent(windowId, operationId) {
    return this.operations.get(windowId) === operationId;
  }

  clear(windowId, operationId) {
    if (this.isCurrent(windowId, operationId)) this.operations.delete(windowId);
  }

  removeWindow(windowId) {
    this.operations.delete(windowId);
  }
}
