// Driver for the markdown-render-speed entry. The harness runs
// `node main.ts` with Node 22+ (type stripping, erasable syntax only).
// It reads every case from $MAKEFUN_INPUT_DIR/cases.json, renders each
// case on its own with parse() from parse.js, and writes the HTML strings
// in order to $MAKEFUN_OUTPUT_DIR/html.json. Outside a container the two
// env vars default to /input and /output.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

type Case = { id: string; markdown: string };

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as Case[];
const rendered: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  rendered[i] = parse(cases[i].markdown);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered));
