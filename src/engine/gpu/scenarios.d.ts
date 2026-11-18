// The validation set-ups of the kit's tests are plain JavaScript modules; the GPU validation runs them unchanged.
declare module '*/shallow-water-scenarios.mjs' {
  const scenarios: Record<string, (...args: any[]) => any>;
  export = scenarios;
}
declare module '*/granular-scenarios.mjs' {
  const scenarios: Record<string, (...args: any[]) => any>;
  export = scenarios;
}
declare module '*/fluid-scenarios.mjs' {
  const scenarios: Record<string, (...args: any[]) => any>;
  export = scenarios;
}
