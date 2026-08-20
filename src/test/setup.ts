import '@testing-library/jest-dom';

// Required for React 18 act() support in jsdom environment
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom não implementa ResizeObserver, e os primitivos do Radix que medem
// (ScrollArea, Popover) o chamam no mount. Sem este dublê qualquer teste que
// renderize um desses estoura com ReferenceError antes da primeira asserção.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
