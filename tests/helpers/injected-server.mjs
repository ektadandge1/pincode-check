import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

// Execute the actual server modules with boundary dependencies replaced, without
// booting Shopify authentication or connecting Prisma to a database.
export function injectedServer(mocks) {
  const cache = new Map();
  const require = createRequire(import.meta.url);
  const replacements = new Map(Object.entries(mocks).map(([path, value]) => [resolve(path), value]));
  function load(path) {
    const filename = resolve(path);
    if (replacements.has(filename)) return replacements.get(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const localRequire = (specifier) => specifier.startsWith(".")
      ? load(resolve(dirname(filename), specifier.endsWith(".ts") ? specifier : `${specifier}.ts`))
      : require(specifier);
    new Function("require", "module", "exports", source)(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
}
