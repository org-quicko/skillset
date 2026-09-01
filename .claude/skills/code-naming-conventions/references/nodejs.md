# Node.js and TypeScript naming conventions

- Use `PascalCase` for classes, interfaces, enums, and type aliases. Use
  `camelCase` for variables, parameters, properties, functions, and
  methods.
- Use `UPPER_SNAKE_CASE` for shared constants. Ordinary `const` values remain
  `camelCase`.
- Name a file after its main export. Use `PascalCase` for a class or type
  file and `camelCase` for other modules: `IncomeTaxReturnManager.ts` and
  `config.ts`.
- Name a test after the module it tests and add `.test`: `config.test.ts` or
  `IncomeTaxReturnManager.test.ts`.
- Use `index.ts` for a module entry point.
- Use lowercase `kebab-case` for domain and feature folders, such as
  `capital-gains` and `business-and-profession`.
- Use singular folder names, such as `api`, `handler`, `manager`, and `dao`.
