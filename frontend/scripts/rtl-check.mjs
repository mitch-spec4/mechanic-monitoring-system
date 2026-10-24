// Fails when a stylesheet uses a physical side (left/right) where a logical one belongs, so every
// layout mirrors when the page is right to left.
//
//   npm run rtl:check
//
// Use inset-inline-start/end, margin-inline-start/end, padding-inline-*, border-inline-*,
// text-align: start/end. A declaration that must stay physical (centring with left: 50%) says
// why in a comment starting "physical:" on the same line.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHYSICAL = [
  /^\s*(left|right)\s*:/,
  /^\s*(margin|padding|border)-(left|right)\b/,
  /^\s*text-align\s*:\s*(left|right)\b/,
  /^\s*float\s*:\s*(left|right)\b/,
  /^\s*border-(top|bottom)-(left|right)-radius\b/,
];
// margin: 1px 2px 3px 4px, where the 2nd (right) and 4th (left) differ.
const UNEVEN_SHORTHAND = /^\s*(margin|padding|inset)\s*:\s*([^\s;()!]+)\s+([^\s;()!]+)\s+([^\s;()!]+)\s+([^\s;()!]+)\s*(!important)?\s*;/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

const problems = [];
for (const file of files(path.join(ROOT, "src"))) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (line.includes("/* physical:")) return;
      const uneven = UNEVEN_SHORTHAND.exec(line);
      if (PHYSICAL.some((pattern) => pattern.test(line)) || (uneven && uneven[3] !== uneven[5])) {
        problems.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
      }
    });
}

if (problems.length) {
  console.error(`Use logical sides (inline-start/end) so the layout mirrors right to left:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("Stylesheets are ready for right-to-left languages.");
