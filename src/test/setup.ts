import "@testing-library/jest-dom";

// setupFiles は全テストの前に毎回読まれる（jsdom も node 環境も）。
// `// @vitest-environment node` のサービステストでは window が存在しないため、
// 無条件に window を参照すると "window is not defined" で落ちる。
// guard を入れて node/jsdom 両環境で安全にする（jsdom では従来どおり matchMedia を定義）。
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
