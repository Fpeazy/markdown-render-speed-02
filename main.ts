// main.ts — driver for the markdown-render-speed-02 entry.
// Reads every case from $MAKEFUN_INPUT_DIR/cases.json (default /input),
// renders each with parse() from ./parse.js, and writes the HTML strings
// in order to $MAKEFUN_OUTPUT_DIR/html.json (default /output).
// Runs as `node main.ts` on Node 22 (type stripping, erasable syntax only).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const inputDir: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases: Case[] = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
