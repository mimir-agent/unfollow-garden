#!/usr/bin/env node
// Turns tmp/VISUAL-<slug>.json into tmp/VISUAL-<slug>.html: one self-contained
// page with styles and screenshots inlined. Exits non-zero, listing every
// problem, if the data doesn't match the catalog.
//
//   node build.mjs <data.json>   validate and write the HTML next to it
//   node build.mjs --schema      print the page and block shapes

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, esc, inlineMarkup } from './blocks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = ['align', 'prep', 'build', 'verify', 'review', 'land'];
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const PAGE_EXAMPLE = {
	branch: 'feat/user-roles',
	title: 'Org admins can change a member’s role',
	summary: 'One sentence a reader needs before any block.',
	example:
		'Dana, an org admin, opens Members, switches Sam from member to admin, and Sam sees the admin menu on their next page load.',
	stage: 'build',
	slices: [
		{ label: 'role column + migration', done: true },
		{ label: 'PATCH endpoint', done: false }
	],
	sources: { read: ['brief', 'diff', 'PR #12'], missing: ['review'] },
	out: ['bulk role changes', 'audit log'],
	blocks: [
		{
			type: 'flow',
			title: 'How a role change moves',
			'…': 'block fields',
			decisions: [
				{
					text: 'Roles live on the membership row, not the user',
					on: 'membership',
					beat: 'a role column on users',
					why: 'a user can belong to several orgs with different roles',
					files: ['src/lib/server/db/schema.ts'],
					source: 'brief: Seams'
				}
			]
		}
	],
	open: ['Should demoting the last admin be blocked or warned?']
};

function printSchema() {
	console.log('PAGE\n' + JSON.stringify(PAGE_EXAMPLE, null, 2));
	console.log(
		`\nstage: one of ${STAGES.join(', ')}. Every block may carry title, intro, and decisions.`
	);
	console.log(
		'decision.source: where it is written (e.g. "brief: Goal", "commit 1a2b3c"), or "conversation" if nowhere.'
	);
	console.log('decision.on: a flow node id, to pin the decision onto that node. Flow only.');
	console.log('decision.files: the paths that carry the decision.');
	console.log(
		'sources.missing containing "brief" adds a line naming what the brief would have given.\n'
	);
	for (const [type, block] of Object.entries(catalog)) {
		console.log(`BLOCK ${type}\n${block.describe}\n${JSON.stringify(block.example, null, 2)}\n`);
	}
}

function validate(page) {
	const errors = [];
	if (typeof page.branch !== 'string') errors.push('page needs `branch`');
	if (typeof page.title !== 'string') errors.push('page needs `title`');
	if (page.stage && !STAGES.includes(page.stage))
		errors.push(`page.stage is "${page.stage}", expected one of: ${STAGES.join(', ')}`);
	for (const field of ['out', 'open', 'slices'])
		if (page[field] !== undefined && !Array.isArray(page[field]))
			errors.push(`page.${field} must be an array`);
	for (const field of ['read', 'missing'])
		if (page.sources?.[field] !== undefined && !Array.isArray(page.sources[field]))
			errors.push(`page.sources.${field} must be an array of short source names`);
	const blocks = Array.isArray(page.blocks) ? page.blocks : [];
	if (!blocks.length) errors.push('page needs a non-empty `blocks` array');

	blocks.forEach((block, i) => {
		const where = `blocks[${i}]${block.type ? ` (${block.type})` : ''}`;
		const def = catalog[block.type];
		if (!def) {
			errors.push(
				`${where}: unknown type "${block.type}". Known: ${Object.keys(catalog).join(', ')}`
			);
			return;
		}
		const blockErrors = [];
		def.check(block, blockErrors);
		const flowIsValid = block.type === 'flow' && !blockErrors.length;
		const decisions = block.decisions ?? [];
		if (!Array.isArray(decisions)) blockErrors.push('`decisions` must be an array');
		(Array.isArray(decisions) ? decisions : []).forEach((d, j) => {
			if (typeof d.text !== 'string') blockErrors.push(`decisions[${j}] needs \`text\``);
			if (typeof d.source !== 'string')
				blockErrors.push(
					`decisions[${j}] needs \`source\` (where it is written, or "conversation")`
				);
			if (d.files !== undefined && !Array.isArray(d.files))
				blockErrors.push(`decisions[${j}].files must be an array of paths`);
			if (d.on && block.type !== 'flow')
				blockErrors.push(`decisions[${j}].on only applies to flow blocks; remove it`);
			else if (d.on && flowIsValid && !block.nodes.some((n) => n.id === d.on))
				blockErrors.push(`decisions[${j}].on "${d.on}" is not a node id in this flow`);
		});
		errors.push(...blockErrors.map((e) => `${where}: ${e}`));
	});
	return errors;
}

// Reads each compare image from disk and attaches it as a data URI.
function embedImages(page, baseDir, errors) {
	for (const block of page.blocks) {
		if (block.type !== 'compare') continue;
		for (const item of block.items) {
			const path = resolve(baseDir, item.src);
			const type = IMAGE_TYPES[extname(path).toLowerCase()];
			if (!type) errors.push(`compare image "${item.src}" must be .png or .jpg`);
			else if (!existsSync(path)) errors.push(`compare image "${item.src}" not found at ${path}`);
			else item.dataUri = `data:${type};base64,${readFileSync(path).toString('base64')}`;
		}
	}
}

function renderDecisions(decisions, firstNumber) {
	if (!decisions?.length) return '';
	const items = decisions.map((d, i) => {
		const recorded = d.source !== 'conversation';
		const detail = [
			d.beat && `<p><span class="k">Beat</span> ${inlineMarkup(d.beat)}</p>`,
			d.why && `<p><span class="k">Why</span> ${inlineMarkup(d.why)}</p>`,
			d.files?.length &&
				`<p><span class="k">Files</span> ${d.files.map((f) => `<code>${esc(f)}</code>`).join(' · ')}</p>`
		]
			.filter(Boolean)
			.join('');
		const label = `<span class="src ${recorded ? 'rec' : 'unrec'}">${recorded ? esc(d.source) : 'conversation only'}</span>`;
		const summary = `<span class="n">${firstNumber + i}</span><span>${inlineMarkup(d.text)} ${label}</span>`;
		return detail
			? `<li><details><summary>${summary}</summary>${detail}</details></li>`
			: `<li><div class="summary">${summary}</div></li>`;
	});
	return `<ol class="decisions">${items.join('')}</ol>`;
}

function renderHeader(page) {
	const stages = page.stage
		? `<ol class="stages">${STAGES.map((s, i) => {
				const at = STAGES.indexOf(page.stage);
				return `<li class="${i < at ? 'done' : i === at ? 'now' : ''}">${s}</li>`;
			}).join('')}</ol>`
		: '';
	const slices = page.slices?.length
		? `<div class="chips">${page.slices.map((s) => `<span class="chip slice${s.done ? ' done' : ''}">${s.done ? '✓ ' : ''}${inlineMarkup(s.label)}</span>`).join('')}</div>`
		: '';
	const read = page.sources?.read?.length ? `Read: ${page.sources.read.map(esc).join(', ')}.` : '';
	const missing = page.sources?.missing?.length
		? ` <span class="warn">Missing: ${page.sources.missing.map(esc).join(', ')}.</span>`
		: '';
	const briefMissing = page.sources?.missing?.some((m) => /^brief\b/i.test(m.trim()));
	// What a brief would have supplied, and the page field each one feeds.
	const fromBrief = [
		['example', 'a concrete example'],
		['out', 'out of scope'],
		['open', 'open questions'],
		['slices', 'planned slices']
	];
	const leftEmpty = fromBrief
		.filter(([field]) => !(Array.isArray(page[field]) ? page[field].length : page[field]))
		.map(([, label]) => label);
	const noBrief = briefMissing
		? `<p class="missing-brief">No brief. ${leftEmpty.length ? `Left empty because of it: ${leftEmpty.join(', ')}.` : 'The PR and commits filled every section a brief would have.'}</p>`
		: '';
	const out = page.out?.length
		? `<div class="out"><span class="k">Not in this work</span>${page.out.map((o) => `<span class="chip ghost">${inlineMarkup(o)}</span>`).join('')}</div>`
		: '';
	return `<header>
	<div class="branch">${esc(page.branch)} · generated ${new Date().toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' })}</div>
	<h1>${inlineMarkup(page.title)}</h1>
	${page.summary ? `<p class="summary">${inlineMarkup(page.summary)}</p>` : ''}
	${page.example ? `<p class="example"><span class="k">For example</span>${inlineMarkup(page.example)}</p>` : ''}
	<p class="meta">${read}${missing}</p>
	${noBrief}
	${stages}${slices}${out}
</header>`;
}

// Decisions are numbered once across the whole page, in block order.
function firstDecisionNumbers(blocks) {
	let next = 1;
	return blocks.map((block) => {
		const first = next;
		next += block.decisions?.length ?? 0;
		return first;
	});
}

function renderPage(page, css) {
	const firsts = firstDecisionNumbers(page.blocks);
	const sections = page.blocks.map((block, i) => {
		const first = firsts[i];
		// Only flow draws pins: decision number by the node id it sits on.
		const pins = new Map(
			(block.decisions ?? []).flatMap((d, j) => (d.on ? [[d.on, first + j]] : []))
		);
		return `<section class="block block-${block.type}">
	${block.title ? `<h2>${inlineMarkup(block.title)}</h2>` : ''}
	${block.intro ? `<p class="intro">${inlineMarkup(block.intro)}</p>` : ''}
	${catalog[block.type].render(block, pins)}
	${renderDecisions(block.decisions, first)}
</section>`;
	});
	const open = page.open?.length
		? `<section class="open"><h2>Still open</h2><ul>${page.open.map((q) => `<li>${inlineMarkup(q)}</li>`).join('')}</ul><p class="meta">Answer in the conversation or the brief, not here.</p></section>`
		: '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.branch)} · orient</title>
<style>${css}</style>
</head>
<body><main>
${renderHeader(page)}
${sections.join('\n')}
${open}
</main></body>
</html>
`;
}

const arg = process.argv[2];
if (!arg || arg === '--help') {
	console.error('usage: node build.mjs <tmp/VISUAL-<slug>.json> | --schema');
	process.exit(2);
}
if (arg === '--schema') {
	printSchema();
	process.exit(0);
}

const dataPath = resolve(arg);
let page;
try {
	page = JSON.parse(readFileSync(dataPath, 'utf8'));
} catch (error) {
	console.error(`Can't read ${dataPath} as JSON: ${error.message}`);
	process.exit(1);
}

const errors = validate(page);
if (!errors.length) embedImages(page, dirname(dataPath), errors);
if (errors.length) {
	console.error(
		`${dataPath} has ${errors.length} problem(s):\n` + errors.map((e) => `  - ${e}`).join('\n')
	);
	process.exit(1);
}

const outPath = dataPath.replace(/\.json$/, '.html');
const css = readFileSync(resolve(HERE, 'style.css'), 'utf8');
writeFileSync(outPath, renderPage(page, css));
console.log(outPath);
