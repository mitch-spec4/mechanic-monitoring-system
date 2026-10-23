// Fails when the app shows text that can't be translated, or text with no Kiswahili.
//
//   npm run i18n:check
//
// It reads every file under src/ (except src/i18n) and reports:
// - words written straight into JSX, or into text attributes (placeholder, title, aria-label, alt, label);
// - strings shown as they are ({ok ? "Saved" : "Failed"}), or handed to setError, setNotice and friends;
// - text passed to t() or mark() that has no entry in src/i18n/sw.ts, or whose {placeholders} differ.
// Text without lowercase letters (codes like "DK-XXXXXXXXXX", "KSh", "PDF") and the product name pass.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const TEXT_ATTRIBUTES = new Set(["placeholder", "title", "aria-label", "alt", "label", "summary", "subject"]);
const MESSAGE_SETTERS = /^(set(Error|Message|Notice|FormError|Note|Sent|Problem|Hint|Info|Warning)|toast)$/;
// confirmAction({ title, message, confirmLabel }): the dialog's words.
const DIALOG_FIELDS = new Set(["title", "message", "confirmLabel"]);
const ALWAYS_OK = new Set(["MechanicPro", "MECHANIC", "PRO", "Kiswahili", "English"]);
// Expressions a shown string can sit inside and still reach the screen unchanged.
const PASS_THROUGH = new Set([
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateSpan,
  ts.SyntaxKind.AsExpression,
]);

// Punctuation around a product name ("MechanicPro.") doesn't make it a sentence.
const needsTranslation = (text) => /[a-z]/.test(text) && !ALWAYS_OK.has(text.replace(/[^\p{L}\p{N}]+/gu, " ").trim());

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "i18n" ? [] : files(full);
    return /\.(tsx?|mts)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function catalog(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const entries = new Map();
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) {
      const key = ts.isStringLiteralLike(node.name) || ts.isIdentifier(node.name) ? node.name.text : null;
      if (key !== null) entries.set(key, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
}

const calleeName = (call) => (ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "");

/** Where a string ends up: "shown" (rendered as is), "translated", or "other" (a class name, a key...). */
function destination(node) {
  let child = node;
  let parent = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent)) {
      const name = calleeName(parent);
      if (name === "t" || name === "mark") return "translated";
      if (MESSAGE_SETTERS.test(name) && parent.arguments[0] === child) return "shown";
      return "other";
    }
    if (ts.isNewExpression(parent))
      return ts.isIdentifier(parent.expression) && ["Error", "ApiError"].includes(parent.expression.text) && parent.arguments?.[0] === child ? "shown" : "other";
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
      const call = parent.parent.parent;
      return DIALOG_FIELDS.has(parent.name.getText()) && call && ts.isCallExpression(call) && calleeName(call) === "confirmAction" ? "shown" : "other";
    }
    if (ts.isJsxAttribute(parent)) {
      if (parent.name.getText() === "text" && parent.parent.parent.tagName?.getText() === "Trans") return "translated";
      return TEXT_ATTRIBUTES.has(parent.name.getText()) ? "shown" : "other";
    }
    if (ts.isJsxExpression(parent)) {
      const holder = parent.parent;
      if (ts.isJsxAttribute(holder)) return TEXT_ATTRIBUTES.has(holder.name.getText()) ? "shown" : "other";
      return ts.isJsxElement(holder) || ts.isJsxFragment(holder) ? "shown" : "other";
    }
    if (ts.isBinaryExpression(parent) && ![ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(parent.operatorToken.kind)) return "other";
    if (ts.isConditionalExpression(parent) && parent.condition === child) return "other";
    if (!PASS_THROUGH.has(parent.kind)) return "other";
    child = parent;
    parent = parent.parent;
  }
  return "other";
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(",");

const sw = catalog(path.join(SRC, "i18n", "sw.ts"));
const problems = [];
const used = new Set();

for (const file of files(SRC)) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = (node) => `${path.relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      // HTML entities such as &nbsp; are spacing, not words.
      const text = node.getText().replace(/&\w+;/g, " ").replace(/\s+/g, " ").trim();
      if (text && needsTranslation(text)) problems.push(`${where(node)}  text not wrapped in t(): ${JSON.stringify(text)}`);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (needsTranslation(node.text) && destination(node) === "shown") problems.push(`${where(node)}  string shown without t(): ${JSON.stringify(node.text)}`);
    } else if (ts.isTemplateExpression(node)) {
      const literal = node.head.text + node.templateSpans.map((span) => span.literal.text).join("");
      if (needsTranslation(literal) && destination(node) === "shown") problems.push(`${where(node)}  template shown without t(): ${JSON.stringify(node.getText())}`);
    } else if (
      (ts.isCallExpression(node) && ["t", "mark"].includes(calleeName(node)) && ts.isIdentifier(node.expression)) ||
      (ts.isJsxAttribute(node) && node.name.getText() === "text" && ts.isJsxSelfClosingElement(node.parent.parent) && node.parent.parent.tagName.getText() === "Trans")
    ) {
      const first = ts.isCallExpression(node) ? node.arguments[0] : node.initializer;
      if (first && ts.isStringLiteralLike(first)) {
        used.add(first.text);
        if (!sw.has(first.text)) problems.push(`${where(node)}  no Kiswahili for: ${JSON.stringify(first.text)}`);
        else if (placeholders(sw.get(first.text)) !== placeholders(first.text)) problems.push(`${where(node)}  placeholders differ in Kiswahili for: ${JSON.stringify(first.text)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const unused = [...sw.keys()].filter((key) => !used.has(key));
if (process.argv.includes("--unused")) for (const key of unused) console.log(`unused: ${JSON.stringify(key)}`);
for (const problem of problems) console.log(problem);
console.log(`${problems.length} problem(s); ${used.size} texts used, ${sw.size} in Kiswahili${unused.length ? `, ${unused.length} unused (--unused lists them)` : ""}.`);
process.exit(problems.length ? 1 : 0);
