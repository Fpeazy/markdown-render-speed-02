import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from './parse.js';

const inputDir: string = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR || '/output';

type InputCase = { id: string; markdown: string };

const cases: InputCase[] = JSON.parse(readFileSync(inputDir + '/cases.json', 'utf8'));
const html: string[] = cases.map((c) => parse(c.markdown));

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputDir + '/html.json', JSON.stringify(html));
