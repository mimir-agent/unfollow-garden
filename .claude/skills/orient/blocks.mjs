// The block catalog. Each entry describes its data shape, checks a block for
// missing or malformed fields, and renders it to an HTML string. build.mjs
// validates every block with `check` before calling any `render`, so render
// functions can assume well-formed data.

export function esc(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// Escapes, then turns `code` and **bold** into markup. Nothing else.
export function inlineMarkup(text) {
	return esc(text)
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function need(block, field, errors, kind = 'string') {
	const value = block[field];
	const ok = kind === 'array' ? Array.isArray(value) && value.length > 0 : typeof value === kind;
	if (!ok) errors.push(`needs \`${field}\` (${kind === 'array' ? 'non-empty array' : kind})`);
	return ok;
}

function oneOf(value, allowed, label, errors) {
	if (!allowed.includes(value))
		errors.push(`${label} is "${value}", expected one of: ${allowed.join(', ')}`);
}

// ---------------------------------------------------------------- files

const CHANGES = ['added', 'modified', 'deleted', 'planned'];

function fileTree(items) {
	const root = { dirs: new Map(), files: [] };
	for (const item of items) {
		const parts = item.path.split('/');
		const name = parts.pop();
		let node = root;
		for (const part of parts) {
			if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
			node = node.dirs.get(part);
		}
		node.files.push({ ...item, name });
	}
	return root;
}

// Folds a chain of single-child directories into one row: src/lib/server/db/.
function collapseSingleChildDirs(name, node) {
	if (node.files.length === 0 && node.dirs.size === 1) {
		const [[childName, child]] = node.dirs;
		return collapseSingleChildDirs(`${name}/${childName}`, child);
	}
	return [name, node];
}

function renderTree(node) {
	const dirs = [...node.dirs].map(([dirName, dirNode]) => {
		const [name, child] = collapseSingleChildDirs(dirName, dirNode);
		return `<li class="dir"><span class="name">${esc(name)}/</span><ul>${renderTree(child)}</ul></li>`;
	});
	const files = node.files.map(
		(file) => `<li class="file ${esc(file.change)}">
	<span class="name">${esc(file.name)}</span>
	<span class="change">${esc(file.change)}</span>
	${file.lines ? `<span class="lines">${esc(file.lines)}</span>` : ''}
	${file.note ? `<span class="note">${inlineMarkup(file.note)}</span>` : ''}
</li>`
	);
	return dirs.join('') + files.join('');
}

const files = {
	describe: 'Changed and planned files as a tree. Use for the shape of the change.',
	example: {
		type: 'files',
		items: [
			{
				path: 'src/routes/api/users/+server.ts',
				change: 'added',
				lines: '+84',
				note: 'GET and PATCH handlers'
			}
		]
	},
	check(block, errors) {
		if (!need(block, 'items', errors, 'array')) return;
		block.items.forEach((item, i) => {
			if (typeof item.path !== 'string') errors.push(`items[${i}] needs \`path\``);
			oneOf(item.change, CHANGES, `items[${i}].change`, errors);
		});
	},
	render: (block) => `<ul class="tree">${renderTree(fileTree(block.items))}</ul>`
};

// ---------------------------------------------------------------- code

// A deliberately small highlighter: comments, strings, keywords, numbers,
// one line at a time. Good enough to read; not a parser.
const TOKEN =
	/(\/\/.*|\/\*.*?\*\/|<!--.*?-->|--\s.*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\b(import|export|from|const|let|function|return|if|else|for|of|await|async|new|type|interface|extends|default|true|false|null|undefined|select|insert|update|delete|where|join|on|table)\b|\b(\d+(?:\.\d+)?)\b/gi;

function highlight(line) {
	let out = '';
	let last = 0;
	for (const match of line.matchAll(TOKEN)) {
		out += esc(line.slice(last, match.index));
		const kind = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'k' : 'n';
		out += `<span class="tok-${kind}">${esc(match[0])}</span>`;
		last = match.index + match[0].length;
	}
	return out + esc(line.slice(last));
}

function lineRange(spec) {
	const [from, to = from] = String(spec).split('-').map(Number);
	return { from, to };
}

const code = {
	describe:
		'A load-bearing excerpt with numbered notes anchored to the lines that matter. `start` is the first line number shown. Keep to a few notes; highlight only files worth reading.',
	example: {
		type: 'code',
		path: 'src/lib/server/auth.ts',
		start: 12,
		code: 'export function resolveAuth(provider: string) {\n\tconst cfg = providers[provider];\n\treturn cfg.token;\n}',
		annotations: [{ lines: '13', label: 'Lookup', note: 'Resolves the provider config by key.' }]
	},
	check(block, errors) {
		need(block, 'path', errors);
		need(block, 'code', errors);
		if (block.start !== undefined && !Number.isInteger(block.start))
			errors.push('`start` must be an integer line number');
		const start = Number.isInteger(block.start) ? block.start : 1;
		const end = start + String(block.code ?? '').split('\n').length - 1;
		(block.annotations ?? []).forEach((a, i) => {
			if (!/^\d+(-\d+)?$/.test(String(a.lines ?? ''))) {
				errors.push(`annotations[${i}] needs \`lines\` as "N" or "N-M"`);
				return;
			}
			const { from, to } = lineRange(a.lines);
			if (!(from >= start && to <= end && from <= to))
				errors.push(`annotations[${i}].lines "${a.lines}" is outside lines ${start}-${end}`);
			if (typeof a.note !== 'string') errors.push(`annotations[${i}] needs \`note\``);
		});
	},
	render(block) {
		const start = block.start ?? 1;
		const notes = block.annotations ?? [];
		const markerFor = (n) => notes.findIndex((a) => lineRange(a.lines).from === n);
		const inNote = (n) =>
			notes.some((a) => n >= lineRange(a.lines).from && n <= lineRange(a.lines).to);
		const rows = block.code.split('\n').map((text, i) => {
			const n = start + i;
			const marker = markerFor(n);
			return `<tr class="${inNote(n) ? 'hl' : ''}"><td class="ln">${n}</td><td class="mk">${marker >= 0 ? `<span class="badge">${marker + 1}</span>` : ''}</td><td class="text">${highlight(text) || ' '}</td></tr>`;
		});
		const list = notes.length
			? `<ol class="code-notes">${notes.map((a) => `<li><strong>${a.label ? esc(a.label) : `Line ${esc(a.lines)}`}</strong> <span class="lines">L${esc(a.lines)}</span> ${inlineMarkup(a.note)}</li>`).join('')}</ol>`
			: '';
		return `<div class="code"><div class="code-path">${esc(block.path)}</div><table>${rows.join('')}</table></div>${list}`;
	}
};

// ---------------------------------------------------------------- endpoints

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const endpoints = {
	describe: 'HTTP endpoints, one collapsible row each. Use when the change adds or alters routes.',
	example: {
		type: 'endpoints',
		items: [
			{
				method: 'PATCH',
				path: '/api/users/:id',
				summary: "Update a user's role or display name.",
				auth: 'session, org admin',
				change: 'added',
				params: [{ name: 'role', in: 'body', type: "'admin' | 'member'", required: false }],
				returns: '200 User · 403 not an admin'
			}
		]
	},
	check(block, errors) {
		if (!need(block, 'items', errors, 'array')) return;
		block.items.forEach((item, i) => {
			oneOf(item.method, METHODS, `items[${i}].method`, errors);
			if (typeof item.path !== 'string') errors.push(`items[${i}] needs \`path\``);
			if (typeof item.summary !== 'string') errors.push(`items[${i}] needs \`summary\``);
			if (item.change) oneOf(item.change, CHANGES, `items[${i}].change`, errors);
		});
	},
	render(block) {
		return block.items
			.map((item) => {
				const params = item.params?.length
					? `<table class="params"><tr><th>Param</th><th>In</th><th>Type</th><th></th></tr>${item.params
							.map(
								(p) =>
									`<tr><td><code>${esc(p.name)}</code>${p.required ? ' <span class="req">required</span>' : ''}</td><td>${esc(p.in ?? '')}</td><td><code>${esc(p.type ?? '')}</code></td><td>${inlineMarkup(p.note ?? '')}</td></tr>`
							)
							.join('')}</table>`
					: '';
				return `<details class="endpoint ${esc(item.change ?? '')}">
	<summary><span class="method m-${esc(item.method.toLowerCase())}">${esc(item.method)}</span><code class="path">${esc(item.path)}</code><span class="sum">${inlineMarkup(item.summary)}</span>${item.change ? `<span class="change">${esc(item.change)}</span>` : ''}</summary>
	<div class="endpoint-body">
		${item.auth ? `<p><span class="k">Auth</span> ${inlineMarkup(item.auth)}</p>` : ''}
		${params}
		${item.returns ? `<p><span class="k">Returns</span> ${inlineMarkup(item.returns)}</p>` : ''}
	</div>
</details>`;
			})
			.join('');
	}
};

// ---------------------------------------------------------------- model

const model = {
	describe:
		'Tables or types with their fields and relations. `key` is pk or fk. Use when the change adds or alters a schema or a durable data shape.',
	example: {
		type: 'model',
		tables: [
			{
				name: 'sessions',
				source: 'src/lib/server/db/schema.ts',
				change: 'added',
				fields: [
					{ name: 'id', type: 'text', key: 'pk' },
					{ name: 'user_id', type: 'text', key: 'fk', note: '→ users.id' },
					{ name: 'expires_at', type: 'integer', change: 'added' }
				]
			}
		],
		relations: [{ from: 'users', to: 'sessions', kind: '1:n', note: 'owns' }]
	},
	check(block, errors) {
		if (!need(block, 'tables', errors, 'array')) return;
		block.tables.forEach((t, i) => {
			if (typeof t.name !== 'string') errors.push(`tables[${i}] needs \`name\``);
			if (!Array.isArray(t.fields) || !t.fields.length)
				errors.push(`tables[${i}] needs \`fields\``);
			if (t.change) oneOf(t.change, CHANGES, `tables[${i}].change`, errors);
			(t.fields ?? []).forEach((f, j) => {
				if (typeof f.name !== 'string') errors.push(`tables[${i}].fields[${j}] needs \`name\``);
				if (f.change) oneOf(f.change, CHANGES, `tables[${i}].fields[${j}].change`, errors);
			});
		});
	},
	render(block) {
		const tables = block.tables
			.map(
				(t) => `<div class="table-card ${esc(t.change ?? '')}">
	<div class="table-head"><strong>${esc(t.name)}</strong>${t.change ? `<span class="change">${esc(t.change)}</span>` : ''}${t.source ? `<span class="src-path">${esc(t.source)}</span>` : ''}</div>
	<table>${t.fields
		.map(
			(f) =>
				`<tr class="${esc(f.change ?? '')}"><td>${f.key ? `<span class="key">${esc(f.key)}</span>` : ''}<code>${esc(f.name)}</code></td><td class="type">${esc(f.type ?? '')}</td><td>${inlineMarkup(f.note ?? '')}${f.change ? ` <span class="change">${esc(f.change)}</span>` : ''}</td></tr>`
		)
		.join('')}</table>
</div>`
			)
			.join('');
		const relations = block.relations?.length
			? `<div class="relations"><span class="k">Relations</span>${block.relations
					.map(
						(r) =>
							`<span class="rel"><code>${esc(r.from)}</code> <span class="kind">${esc(r.kind)}</span> <code>${esc(r.to)}</code>${r.note ? ` <span class="muted">${inlineMarkup(r.note)}</span>` : ''}</span>`
					)
					.join('')}</div>`
			: '';
		return `<div class="tables">${tables}</div>${relations}`;
	}
};

// ---------------------------------------------------------------- flow

const STATES = ['built', 'planned', 'ruled-out', 'core'];
const COL_W = 230;
const ROW_H = 96;
const NODE_W = 180;
const NODE_H = 52;
const PAD = 24;

// Where an arrow from node box `a` to node box `b` starts and ends: side to
// side on the same row, otherwise bottom to top (or top to bottom going up).
// The 2px gap keeps the arrowhead off the box border.
function edgeEnds(a, b) {
	const midY = NODE_H / 2;
	const midX = NODE_W / 2;
	if (a.y === b.y && b.x > a.x)
		return { x1: a.x + NODE_W, y1: a.y + midY, x2: b.x - 2, y2: b.y + midY };
	if (a.y === b.y) return { x1: a.x, y1: a.y + midY, x2: b.x + NODE_W + 2, y2: b.y + midY };
	if (b.y > a.y) return { x1: a.x + midX, y1: a.y + NODE_H, x2: b.x + midX, y2: b.y - 2 };
	return { x1: a.x + midX, y1: a.y, x2: b.x + midX, y2: b.y + NODE_H + 2 };
}

const flow = {
	describe:
		'A boxes-and-arrows diagram on a grid. Place nodes with `col` and `row` (0-based); the renderer draws it. Use for how parts talk, what data moves, or a user flow. Mark ruled-out options as `ruled-out` nodes instead of listing them elsewhere. `fragile` edges are implicit contracts.',
	example: {
		type: 'flow',
		nodes: [
			{ id: 'form', label: 'Sign-up form', sub: 'routes/signup', col: 0, row: 0, state: 'built' },
			{ id: 'action', label: 'Form action', sub: '+page.server.ts', col: 1, row: 0, state: 'core' },
			{ id: 'db', label: 'users table', col: 2, row: 0, state: 'built' },
			{ id: 'oauth', label: 'OAuth only', col: 1, row: 1, state: 'ruled-out' }
		],
		edges: [
			{ from: 'form', to: 'action', label: 'POST' },
			{ from: 'action', to: 'db', label: 'insert', fragile: true }
		]
	},
	check(block, errors) {
		if (!need(block, 'nodes', errors, 'array')) return;
		const ids = new Set();
		block.nodes.forEach((n, i) => {
			if (typeof n.id !== 'string') errors.push(`nodes[${i}] needs \`id\``);
			if (typeof n.label !== 'string') errors.push(`nodes[${i}] needs \`label\``);
			if (!Number.isInteger(n.col) || !Number.isInteger(n.row))
				errors.push(`nodes[${i}] needs integer \`col\` and \`row\``);
			oneOf(n.state ?? 'built', STATES, `nodes[${i}].state`, errors);
			if (ids.has(n.id)) errors.push(`nodes[${i}].id "${n.id}" is used twice`);
			ids.add(n.id);
		});
		(block.edges ?? []).forEach((e, i) => {
			if (!ids.has(e.from)) errors.push(`edges[${i}].from "${e.from}" is not a node id`);
			if (!ids.has(e.to)) errors.push(`edges[${i}].to "${e.to}" is not a node id`);
		});
	},
	render(block, pins) {
		const pos = new Map(
			block.nodes.map((n) => [n.id, { x: PAD + n.col * COL_W, y: PAD + n.row * ROW_H }])
		);
		const width = PAD * 2 + (Math.max(...block.nodes.map((n) => n.col)) * COL_W + NODE_W);
		const height = PAD * 2 + (Math.max(...block.nodes.map((n) => n.row)) * ROW_H + NODE_H);

		const edges = (block.edges ?? []).map((e) => {
			const a = pos.get(e.from);
			const b = pos.get(e.to);
			const { x1, y1, x2, y2 } = edgeEnds(a, b);
			const d =
				a.y === b.y || x1 === x2
					? `M${x1},${y1} L${x2},${y2}`
					: `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
			const label = e.label
				? `<text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${esc(e.label)}</text>`
				: '';
			return `<path class="edge${e.fragile ? ' fragile' : ''}${e.planned ? ' planned' : ''}" d="${d}" marker-end="url(#${e.fragile ? 'arr-warn' : 'arr'})" />${label}`;
		});

		const nodes = block.nodes.map((n) => {
			const { x, y } = pos.get(n.id);
			const state = n.state ?? 'built';
			const struck =
				state === 'ruled-out'
					? `<path class="x" d="M${x + NODE_W - 22},${y + 18} l12,14 m0,-14 l-12,14" />`
					: '';
			const pin = pins.get(n.id);
			const pinMark = pin
				? `<circle class="pin" cx="${x + NODE_W}" cy="${y}" r="9" /><text class="pin-t" x="${x + NODE_W}" y="${y + 4}" text-anchor="middle">${pin}</text>`
				: '';
			return `<g class="node ${esc(state)}"><rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="7" />
<text class="label" x="${x + 12}" y="${y + (n.sub ? 22 : 31)}">${esc(n.label)}</text>
${n.sub ? `<text class="sub" x="${x + 12}" y="${y + 39}">${esc(n.sub)}</text>` : ''}${struck}${pinMark}</g>`;
		});

		const aria = block.caption ?? block.title ?? 'Diagram';
		return `<figure class="flow"><svg width="${width}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}">
<defs>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead" /></marker>
<marker id="arr-warn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead warn" /></marker>
</defs>
${edges.join('\n')}
${nodes.join('\n')}
</svg>${block.caption ? `<figcaption>${inlineMarkup(block.caption)}</figcaption>` : ''}</figure>`;
	}
};

// ---------------------------------------------------------------- compare

const compare = {
	describe:
		'Screenshots side by side, usually before (main) and after (branch). `src` is a PNG or JPEG path relative to the data file; build.mjs embeds it. Labels go here, never inside the image.',
	example: {
		type: 'compare',
		items: [
			{ label: 'Before', src: 'orient-shots/settings-main.png' },
			{ label: 'After', src: 'orient-shots/settings-branch.png' }
		]
	},
	check(block, errors) {
		if (!need(block, 'items', errors, 'array')) return;
		block.items.forEach((item, i) => {
			if (typeof item.label !== 'string') errors.push(`items[${i}] needs \`label\``);
			if (typeof item.src !== 'string') errors.push(`items[${i}] needs \`src\``);
		});
	},
	render: (block) =>
		`<div class="compare">${block.items
			.map(
				(item) =>
					`<figure><figcaption>${esc(item.label)}</figcaption><img src="${item.dataUri}" alt="${esc(item.label)}" /></figure>`
			)
			.join('')}</div>`
};

// ---------------------------------------------------------------- note

const note = {
	describe:
		'A short paragraph, only for what no other block can show. Supports `code` and **bold**.',
	example: {
		type: 'note',
		text: 'All endpoints require a session; `requireUser` lives in `hooks.server.ts`.'
	},
	check(block, errors) {
		need(block, 'text', errors);
	},
	render: (block) => `<p class="note">${inlineMarkup(block.text)}</p>`
};

export const catalog = { flow, files, code, endpoints, model, compare, note };
