/**
 * Safe evaluator for the subset of After Effects expressions used by Essential Graphics templates.
 *
 * Expressions come from untrusted files, so nothing is handed to the JavaScript engine: a tokenizer
 * and a recursive-descent interpreter expose only
 * - `comp()`, `thisComp`, `thisLayer`, `.layer()`, `.effect()(param)`, `effect()(param)`;
 * - `value`, `time`, `posterizeTime()`, `wiggle()` (approximated), `linear`, `ease`, `clamp`;
 * - literals, arrays, indexing, arithmetic, comparisons, `?:`, `if/else` and assignments.
 *
 * Anything else keeps the keyframed value and returns a reason for the compatibility report.
 */

export type ControlOverrideValue = string | number | boolean | number[];

/** A reference to an effect parameter. Omitted `comp`/`layer` mean the current ones. */
export interface ExpressionPropertyRef {
	comp?: string;
	layer?: string | number;
	effect: string | number;
	param: string | number;
}

export interface ExpressionEvalContext {
	/** Composition time. */
	tSec: number;
	/** Pre-expression value at a composition time, in the units expressions see. */
	valueAt(tSec: number): number[];
	resolveProperty(ref: ExpressionPropertyRef, tSec: number): number[] | undefined;
	/** Seeds `wiggle`, so that different properties move differently. */
	seed?: number;
}

export interface ExpressionEvalResult {
	supported: boolean;
	value: number[];
	approximated?: boolean;
	reason?: string;
}

export function hexStringToRgba01(hex: string): [number, number, number, number] | null {
	const clean = hex.trim().replace(/^#/, '');
	if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(clean)) return null;
	const channel = (offset: number): number => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255;
	return [channel(0), channel(2), channel(4), clean.length === 8 ? channel(6) : 1];
}

const MAX_EXPRESSION_LENGTH = 20000;
const MAX_NESTING = 64;
const PUNCTUATION = [
	'===', '!==', '==', '!=', '>=', '<=', '&&', '||',
	'(', ')', '[', ']', '{', '}', ',', ';', '.', '+', '-', '*', '/', '%', '<', '>', '=', '?', ':', '!',
];

interface Token {
	type: 'number' | 'string' | 'name' | 'punct' | 'end';
	text: string;
	/** A line break precedes the token. */
	newline: boolean;
}

type Node =
	| { type: 'number'; value: number }
	| { type: 'string'; value: string }
	| { type: 'name'; name: string }
	| { type: 'array'; items: Node[] }
	| { type: 'member'; target: Node; name: string }
	| { type: 'index'; target: Node; index: Node }
	| { type: 'call'; target: Node; args: Node[] }
	| { type: 'unary'; op: string; operand: Node }
	| { type: 'binary'; op: string; left: Node; right: Node }
	| { type: 'conditional'; test: Node; then: Node; otherwise?: Node }
	| { type: 'assign'; name: string; value: Node }
	| { type: 'block'; body: Node[] };

type Value =
	| number
	| number[]
	| string
	| { scope: { comp?: string; layer?: string | number } }
	| { effect: Omit<ExpressionPropertyRef, 'param'> };

class Unsupported extends Error {}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;
	let newline = false;
	const push = (type: Token['type'], text: string): void => {
		tokens.push({ type, text, newline });
		newline = false;
	};

	while (pos < source.length) {
		const char = source[pos]!;
		if (char === '\r' || char === '\n') {
			newline = true;
			pos++;
		} else if (/\s/.test(char)) {
			pos++;
		} else if (source.startsWith('//', pos)) {
			while (pos < source.length && source[pos] !== '\r' && source[pos] !== '\n') pos++;
		} else if (source.startsWith('/*', pos)) {
			const end = source.indexOf('*/', pos + 2);
			if (end < 0) throw new Unsupported('comentário não terminado');
			pos = end + 2;
		} else if (char === '"' || char === "'") {
			let text = '';
			pos++;
			while (pos < source.length && source[pos] !== char) {
				if (source[pos] === '\\') pos++;
				text += source[pos++] ?? '';
			}
			if (pos >= source.length) throw new Unsupported('string não terminada');
			pos++;
			push('string', text);
		} else if (/[\d.]/.test(char) && /^(\d|\.\d)/.test(source.slice(pos, pos + 2))) {
			const text = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(pos))![0];
			pos += text.length;
			push('number', text);
		} else if (/[A-Za-z_$]/.test(char)) {
			const text = /^[A-Za-z_$][\w$]*/.exec(source.slice(pos))![0];
			pos += text.length;
			push('name', text);
		} else {
			const text = PUNCTUATION.find((punct) => source.startsWith(punct, pos));
			if (!text) throw new Unsupported(`caractere "${char}"`);
			pos += text.length;
			push('punct', text);
		}
	}
	tokens.push({ type: 'end', text: '', newline: true });
	return tokens;
}

const PRECEDENCE: string[][] = [
	['||'],
	['&&'],
	['==', '!=', '===', '!=='],
	['<', '>', '<=', '>='],
	['+', '-'],
	['*', '/', '%'],
];

class Parser {
	private pos = 0;
	private depth = 0;

	constructor(private readonly tokens: Token[]) {}

	program(): Node[] {
		const body: Node[] = [];
		while (this.peek().type !== 'end') {
			if (this.accept(';')) continue;
			body.push(this.statement());
		}
		return body;
	}

	private peek(offset = 0): Token {
		return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
	}

	private is(text: string): boolean {
		const token = this.peek();
		return (token.type === 'punct' || token.type === 'name') && token.text === text;
	}

	private accept(text: string): boolean {
		if (!this.is(text)) return false;
		this.pos++;
		return true;
	}

	private expect(text: string): void {
		if (!this.accept(text)) throw new Unsupported(`esperava "${text}"`);
	}

	private nested<T>(parse: () => T): T {
		if (++this.depth > MAX_NESTING) throw new Unsupported('aninhamento excessivo');
		const result = parse();
		this.depth--;
		return result;
	}

	private statement(): Node {
		return this.nested(() => {
			if (this.accept('{')) {
				const body: Node[] = [];
				while (!this.accept('}')) {
					if (this.peek().type === 'end') throw new Unsupported('esperava "}"');
					if (!this.accept(';')) body.push(this.statement());
				}
				return { type: 'block', body };
			}
			if (this.accept('if')) {
				this.expect('(');
				const test = this.expression();
				this.expect(')');
				const then = this.statement();
				this.accept(';');
				return this.accept('else')
					? { type: 'conditional', test, then, otherwise: this.statement() }
					: { type: 'conditional', test, then };
			}
			const declared = this.accept('var') || this.accept('let') || this.accept('const');
			const target = this.peek();
			let node: Node;
			if (target.type === 'name' && this.peek(1).type === 'punct' && this.peek(1).text === '=') {
				this.pos += 2;
				node = { type: 'assign', name: target.text, value: this.expression() };
			} else if (declared) {
				throw new Unsupported('declaração sem valor');
			} else {
				node = this.expression();
			}
			if (!this.accept(';') && !this.is('}') && !this.peek().newline) {
				throw new Unsupported(`sintaxe perto de "${this.peek().text}"`);
			}
			return node;
		});
	}

	private expression(): Node {
		return this.nested(() => {
			const test = this.binary(0);
			if (!this.accept('?')) return test;
			const then = this.expression();
			this.expect(':');
			return { type: 'conditional', test, then, otherwise: this.expression() };
		});
	}

	private binary(level: number): Node {
		const operators = PRECEDENCE[level];
		if (!operators) return this.unary();
		let left = this.binary(level + 1);
		for (;;) {
			const token = this.peek();
			if (token.type !== 'punct' || !operators.includes(token.text)) return left;
			this.pos++;
			left = { type: 'binary', op: token.text, left, right: this.binary(level + 1) };
		}
	}

	private unary(): Node {
		for (const op of ['-', '+', '!']) {
			if (this.accept(op)) return { type: 'unary', op, operand: this.nested(() => this.unary()) };
		}
		return this.postfix();
	}

	private postfix(): Node {
		let node = this.primary();
		for (;;) {
			const token = this.peek();
			if (token.type !== 'punct') return node;
			// Like JavaScript's ASI, a line starting with `[` or `(` starts a new statement here.
			if (token.newline && token.text !== '.') return node;
			if (this.accept('.')) {
				const name = this.peek();
				if (name.type !== 'name') throw new Unsupported('propriedade inválida');
				this.pos++;
				node = { type: 'member', target: node, name: name.text };
			} else if (this.accept('[')) {
				node = { type: 'index', target: node, index: this.expression() };
				this.expect(']');
			} else if (this.accept('(')) {
				node = { type: 'call', target: node, args: this.list(')') };
			} else {
				return node;
			}
		}
	}

	private list(closing: string): Node[] {
		const items: Node[] = [];
		if (this.accept(closing)) return items;
		do items.push(this.expression());
		while (this.accept(','));
		this.expect(closing);
		return items;
	}

	private primary(): Node {
		const token = this.peek();
		this.pos++;
		if (token.type === 'number') return { type: 'number', value: Number(token.text) };
		if (token.type === 'string') return { type: 'string', value: token.text };
		if (token.type === 'name') return { type: 'name', name: token.text };
		if (token.type === 'punct' && token.text === '(') {
			const inner = this.expression();
			this.expect(')');
			return inner;
		}
		if (token.type === 'punct' && token.text === '[') return { type: 'array', items: this.list(']') };
		throw new Unsupported(`sintaxe perto de "${token.text}"`);
	}
}

function asNumber(value: Value): number {
	if (typeof value === 'number') return value;
	if (Array.isArray(value) && value.length === 1) return value[0]!;
	throw new Unsupported('esperava um número');
}

function asVector(value: Value): number[] {
	if (typeof value === 'number') return [value];
	if (Array.isArray(value)) return value;
	throw new Unsupported('o resultado não é numérico');
}

function asKey(value: Value): string | number {
	return typeof value === 'string' ? value : asNumber(value);
}

function truthy(value: Value): boolean {
	return typeof value === 'string' ? value !== '' : asNumber(value) !== 0;
}

function hashUnit(seed: number): number {
	let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
	return (((x ^ (x >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

class Interpreter {
	approximated = false;
	private time: number;
	private readonly variables = new Map<string, Value>();

	constructor(private readonly ctx: ExpressionEvalContext) {
		this.time = ctx.tSec;
	}

	run(body: Node[]): Value | undefined {
		let last: Value | undefined;
		for (const node of body) last = this.statement(node) ?? last;
		return last;
	}

	private statement(node: Node): Value | undefined {
		if (node.type === 'block') return this.run(node.body);
		if (node.type === 'assign') {
			const value = this.evaluate(node.value);
			this.variables.set(node.name, value);
			return value;
		}
		if (node.type === 'conditional') {
			if (truthy(this.evaluate(node.test))) return this.statement(node.then);
			return node.otherwise ? this.statement(node.otherwise) : undefined;
		}
		if (node.type === 'call' && node.target.type === 'name' && node.target.name === 'posterizeTime') {
			const fps = asNumber(this.evaluate(node.args[0] ?? { type: 'number', value: 0 }));
			if (fps > 0) this.time = Math.floor(this.time * fps + 1e-6) / fps;
			return undefined;
		}
		return this.evaluate(node);
	}

	private evaluate(node: Node): Value {
		switch (node.type) {
			case 'number':
				return node.value;
			case 'string':
				return node.value;
			case 'array':
				return node.items.map((item) => asNumber(this.evaluate(item)));
			case 'name':
				return this.name(node.name);
			case 'member': {
				const target = this.evaluate(node.target);
				if (node.name === 'value' && (typeof target === 'number' || Array.isArray(target))) return target;
				throw new Unsupported(`propriedade .${node.name}`);
			}
			case 'index': {
				const vector = asVector(this.evaluate(node.target));
				const value = vector[asNumber(this.evaluate(node.index))];
				if (value === undefined) throw new Unsupported('índice fora do vetor');
				return value;
			}
			case 'unary': {
				const operand = this.evaluate(node.operand);
				if (node.op === '!') return truthy(operand) ? 0 : 1;
				if (node.op === '+') return operand;
				return typeof operand === 'number' ? -operand : asVector(operand).map((v) => -v);
			}
			case 'binary':
				return this.binary(node.op, this.evaluate(node.left), node.right);
			case 'conditional': {
				const branch = truthy(this.evaluate(node.test)) ? node.then : node.otherwise;
				if (!branch) throw new Unsupported('condição sem valor');
				return this.evaluate(branch);
			}
			case 'call':
				return this.call(node.target, node.args);
			default:
				throw new Unsupported(`"${node.type}" dentro de uma expressão`);
		}
	}

	private name(name: string): Value {
		const variable = this.variables.get(name);
		if (variable !== undefined) return variable;
		switch (name) {
			case 'time':
				return this.time;
			case 'value': {
				const value = this.ctx.valueAt(this.time);
				return value.length === 1 ? value[0]! : value;
			}
			case 'true':
				return 1;
			case 'false':
				return 0;
			case 'thisComp':
			case 'thisLayer':
				return { scope: {} };
			default:
				throw new Unsupported(`identificador "${name}"`);
		}
	}

	private binary(op: string, left: Value, rightNode: Node): Value {
		if (op === '&&') return truthy(left) ? this.evaluate(rightNode) : left;
		if (op === '||') return truthy(left) ? left : this.evaluate(rightNode);
		const right = this.evaluate(rightNode);
		switch (op) {
			case '==':
			case '===':
				return asKey(left) === asKey(right) ? 1 : 0;
			case '!=':
			case '!==':
				return asKey(left) !== asKey(right) ? 1 : 0;
			case '<':
				return asNumber(left) < asNumber(right) ? 1 : 0;
			case '>':
				return asNumber(left) > asNumber(right) ? 1 : 0;
			case '<=':
				return asNumber(left) <= asNumber(right) ? 1 : 0;
			case '>=':
				return asNumber(left) >= asNumber(right) ? 1 : 0;
			case '+':
			case '-': {
				const sign = op === '+' ? 1 : -1;
				if (typeof left === 'number' && typeof right === 'number') return left + sign * right;
				const a = asVector(left);
				const b = asVector(right);
				return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + sign * (b[i] ?? 0));
			}
			case '*':
				if (Array.isArray(right) && typeof left === 'number') return right.map((v) => v * left);
				if (Array.isArray(left)) return left.map((v) => v * asNumber(right));
				return asNumber(left) * asNumber(right);
			case '/':
				if (Array.isArray(left)) return left.map((v) => v / asNumber(right));
				return asNumber(left) / asNumber(right);
			case '%':
				return asNumber(left) % asNumber(right);
			default:
				throw new Unsupported(`operador ${op}`);
		}
	}

	private call(target: Node, argNodes: Node[]): Value {
		const args = argNodes.map((arg) => this.evaluate(arg));
		const arg = (i: number): Value => {
			const value = args[i];
			if (value === undefined) throw new Unsupported('argumento ausente');
			return value;
		};

		if (target.type === 'name' && !this.variables.has(target.name)) {
			switch (target.name) {
				case 'comp':
					return { scope: { comp: String(asKey(arg(0))) } };
				case 'effect':
					return { effect: { effect: asKey(arg(0)) } };
				case 'wiggle':
					return this.wiggle(asNumber(arg(0)), asNumber(arg(1)));
				case 'clamp':
					return Math.max(asNumber(arg(1)), Math.min(asNumber(arg(2)), asNumber(arg(0))));
				case 'linear':
				case 'ease': {
					const from = asNumber(arg(1));
					const span = asNumber(arg(2)) - from;
					let u = Math.max(0, Math.min(1, span ? (asNumber(arg(0)) - from) / span : 1));
					if (target.name === 'ease') u = u * u * (3 - 2 * u);
					const a = asNumber(arg(3));
					return a + (asNumber(arg(4)) - a) * u;
				}
				default:
					throw new Unsupported(`função ${target.name}()`);
			}
		}

		if (target.type === 'member') {
			const object = this.evaluate(target.target);
			if (typeof object === 'object' && 'scope' in object) {
				if (target.name === 'layer') return { scope: { ...object.scope, layer: asKey(arg(0)) } };
				if (target.name === 'effect') return { effect: { ...object.scope, effect: asKey(arg(0)) } };
			}
			throw new Unsupported(`método .${target.name}()`);
		}

		const callee = this.evaluate(target);
		if (typeof callee !== 'object' || !('effect' in callee)) throw new Unsupported('chamada inválida');
		const ref: ExpressionPropertyRef = { ...callee.effect, param: asKey(arg(0)) };
		const value = this.ctx.resolveProperty(ref, this.time);
		if (!value) throw new Unsupported(`propriedade não encontrada: effect("${ref.effect}")("${ref.param}")`);
		return value.length === 1 ? value[0]! : value;
	}

	/** Seeded value noise: same character as AE's wiggle, not the same curve. */
	private wiggle(frequency: number, amplitude: number): number[] {
		this.approximated = true;
		const phase = this.time * frequency;
		const step = Math.floor(phase);
		const u = phase - step;
		const smooth = u * u * (3 - 2 * u);
		return this.ctx.valueAt(this.time).map((value, dim) => {
			const seed = (this.ctx.seed ?? 0) * 7919 + dim * 104729;
			const a = hashUnit(seed + step);
			const b = hashUnit(seed + step + 1);
			return value + amplitude * (a + (b - a) * smooth);
		});
	}
}

const programCache = new Map<string, Node[]>();

function compile(expression: string): Node[] {
	const cached = programCache.get(expression);
	if (cached) return cached;
	if (expression.length > MAX_EXPRESSION_LENGTH) throw new Unsupported('expressão longa demais');
	const program = new Parser(tokenize(expression)).program();
	if (programCache.size >= 2000) programCache.clear();
	programCache.set(expression, program);
	return program;
}

/** Evaluates an AE expression in the units expressions see. */
export function evaluateAeExpression(expression: string, ctx: ExpressionEvalContext): ExpressionEvalResult {
	try {
		const interpreter = new Interpreter(ctx);
		const result = interpreter.run(compile(expression));
		if (result === undefined) throw new Unsupported('a expressão não produz valor');
		const value = asVector(result);
		if (!value.every(Number.isFinite)) throw new Unsupported('resultado não finito');
		return { supported: true, value, ...(interpreter.approximated ? { approximated: true } : {}) };
	} catch (error) {
		if (!(error instanceof Unsupported)) throw error;
		return {
			supported: false,
			value: ctx.valueAt(ctx.tSec),
			reason: `Expressão fora do subconjunto suportado: ${error.message}`,
		};
	}
}
