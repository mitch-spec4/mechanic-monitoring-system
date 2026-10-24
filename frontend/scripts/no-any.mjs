// Fails when code under src/ or e2e/ uses the `any` type, which turns type checking off.
//
//   npm run types:check
//
// Use the API's types from src/services/types.ts instead, or `unknown` for data you check first.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|mts)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

const problems = [];
for (const file of [...files(path.join(ROOT, "src")), ...files(path.join(ROOT, "e2e"))]) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      problems.push(`${path.relative(ROOT, file)}:${line + 1}: ${node.parent.getText().slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error(`The \`any\` type turns off type checking. Use a real type, or \`unknown\`:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("No `any` types.");
