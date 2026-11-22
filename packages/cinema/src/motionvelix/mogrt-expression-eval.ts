/**
 * Safe, deterministic After Effects expression evaluator for MOGRT control bindings.
 *
 * Supports real control-link expressions without `eval()` or arbitrary JS execution:
 * - `comp("CompName").layer("LayerName").effect("EffectName")("ParamName")`
 * - `thisComp.layer("LayerName").effect("EffectName")("ParamName")`
 * - `effect("EffectName")("ParamName")`
 * - Indexed vector access (`[0]`, `[1]`, `[2]`, `[3]`) and `.value`
 * - `linear(t, tMin, tMax, v1, v2)`, `ease(t, tMin, tMax, v1, v2)`, `clamp(v, lo, hi)`
 * - Ternary conditions (`cond == 1 ? a : b`, `cond > 0 ? a : b`, `cond ? a : b`)
 * - Simple arithmetic (`+`, `-`, `*`, `/`) and 2D vector literals (`[a, b]`)
 *
 * Unsupported expressions (e.g. `wiggle()`, `sampleImage()`, `sourceRectAtTime()`)
 * are explicitly recorded and fall back to the property's keyframed/static value.
 */

import type { AepGraphComposition } from './aep-comp-graph.js';
import { evaluatePropertyAtTime } from './aep-comp-graph.js';

export type ControlOverrideValue =
	| string
	| number
	| boolean
	| number[];

export interface ExpressionEvalContext {
	tSec: number;
	currentComp: AepGraphComposition;
	currentLayerName: string;
	compositionsByName: Map<string, AepGraphComposition>;
	/** User overrides keyed by control UI name or effect display name (case-insensitive lookup). */
	controlOverrides: Record<string, ControlOverrideValue>;
	/** Property's base value (keyframed or static) for `value` references. */
	baseValue: number[] | string;
	/** Optional audit collectors for compatibility reporting. */
	audit?: {
		supportedEvaluated: number;
		unsupported: Array<{ compName: string; layerName: string; expression: string; reason: string }>;
	};
}

export interface ExpressionEvalResult {
	supported: boolean;
	value: number[] | string;
	reason?: string;
}

export function hexStringToRgba01(hex: string): [number, number, number, number] | null {
	const clean = hex.trim().replace(/^#/, '');
	if (clean.length !== 6 && clean.length !== 8) return null;
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	const a = clean.length === 8 ? Number.parseInt(clean.slice(6, 8), 16) : 255;
	if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
	return [r / 255, g / 255, b / 255, a / 255];
}

function normalizeOverrideValue(raw: ControlOverrideValue): number[] | string {
	if (typeof raw === 'boolean') return [raw ? 1 : 0];
	if (typeof raw === 'number') return [raw];
	if (Array.isArray(raw)) return raw.map(Number);
	const asColor = hexStringToRgba01(raw);
	if (asColor) return asColor;
	return raw;
}

function findOverride(
	overrides: Record<string, ControlOverrideValue>,
	candidates: string[],
): number[] | string | null {
	const entries = Object.entries(overrides);
	if (entries.length === 0) return null;
	const lowerMap = new Map<string, ControlOverrideValue>();
	for (const [k, v] of entries) {
		lowerMap.set(k.trim().toLowerCase(), v);
	}
	for (const cand of candidates) {
		const hit = lowerMap.get(cand.trim().toLowerCase());
		if (hit !== undefined) return normalizeOverrideValue(hit);
	}
	return null;
}

function lookupControlReference(
	ctx: ExpressionEvalContext,
	compName: string | null,
	layerName: string | null,
	effectName: string,
	paramName: string,
): number[] | string | null {
	// 1. Check user overrides first (never mutates original .mogrt / .aep)
	const override = findOverride(ctx.controlOverrides, [
		effectName,
		`${effectName} ${paramName}`,
		`${layerName ?? ''}.${effectName}`,
		paramName,
	]);
	if (override !== null) return override;

	// 2. Look up inside the AEP composition graph
	const targetComp = compName ? ctx.compositionsByName.get(compName) : ctx.currentComp;
	if (!targetComp) return null;

	const targetLayer = layerName
		? targetComp.layers.find((l) => l.name.toLowerCase() === layerName.toLowerCase())
		: targetComp.layers.find((l) => l.name.toLowerCase() === ctx.currentLayerName.toLowerCase());
	if (!targetLayer) return null;

	const fx = targetLayer.effects.find(
		(e) =>
			e.displayName.toLowerCase() === effectName.toLowerCase() ||
			e.matchName.toLowerCase() === effectName.toLowerCase(),
	);
	if (!fx) return null;

	const param =
		fx.params.find(
			(p) =>
				p.name.toLowerCase() === paramName.toLowerCase() ||
				p.matchName.toLowerCase() === paramName.toLowerCase(),
		) ?? fx.params[0];
	if (!param) return null;

	return evaluatePropertyAtTime(param.property, ctx.tSec);
}

const UNSUPPORTED_APIS = [
	'wiggle',
	'sampleImage',
	'sourceRectAtTime',
	'toComp',
	'fromComp',
	'toWorld',
	'loopOut',
	'loopIn',
	'posterizeTime',
	'createPath',
];

function evaluateSimpleNumericAtom(token: string, ctx: ExpressionEvalContext): number[] | string | null {
	const trimmed = token.trim().replace(/;+$/, '');
	if (!trimmed) return null;

	// Quoted string literal
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	// Numeric literal
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
		return [Number(trimmed)];
	}

	if (trimmed === 'time') return [ctx.tSec];
	if (trimmed === 'value') return ctx.baseValue;

	// Indexed property suffix `[k]`
	let indexSuffix: number | null = null;
	let core = trimmed;
	const idxMatch = /\[(\d+)\]$/.exec(core);
	if (idxMatch && !core.startsWith('[')) {
		indexSuffix = Number(idxMatch[1]);
		core = core.slice(0, idxMatch.index).trim();
	}
	core = core.replace(/\.value$/, '').trim();

	// Vector literal `[a, b]` or `[a, b, c, d]`
	if (core.startsWith('[') && core.endsWith(']')) {
		const parts = splitTopLevel(core.slice(1, -1), ',');
		const vec: number[] = [];
		for (const part of parts) {
			const evaluated = evaluateExprInternal(part, ctx);
			if (!evaluated || typeof evaluated === 'string') return null;
			vec.push(evaluated[0] ?? 0);
		}
		return indexSuffix !== null ? [vec[indexSuffix] ?? 0] : vec;
	}

	// `comp("X").layer("Y").effect("Z")("P")`
	const fullRef =
		/^comp\(\s*["']([^"']+)["']\s*\)\.layer\(\s*["']([^"']+)["']\s*\)\.effect\(\s*["']([^"']+)["']\s*\)\(\s*["']([^"']+)["']\s*\)$/.exec(
			core,
		);
	if (fullRef) {
		const val = lookupControlReference(ctx, fullRef[1]!, fullRef[2]!, fullRef[3]!, fullRef[4]!);
		if (val === null) return null;
		if (indexSuffix !== null && Array.isArray(val)) return [val[indexSuffix] ?? 0];
		return val;
	}

	// `thisComp.layer("Y").effect("Z")("P")`
	const thisCompRef =
		/^thisComp\.layer\(\s*["']([^"']+)["']\s*\)\.effect\(\s*["']([^"']+)["']\s*\)\(\s*["']([^"']+)["']\s*\)$/.exec(
			core,
		);
	if (thisCompRef) {
		const val = lookupControlReference(ctx, null, thisCompRef[1]!, thisCompRef[2]!, thisCompRef[3]!);
		if (val === null) return null;
		if (indexSuffix !== null && Array.isArray(val)) return [val[indexSuffix] ?? 0];
		return val;
	}

	// `effect("Z")("P")`
	const localRef = /^effect\(\s*["']([^"']+)["']\s*\)\(\s*["']([^"']+)["']\s*\)$/.exec(core);
	if (localRef) {
		const val = lookupControlReference(ctx, null, null, localRef[1]!, localRef[2]!);
		if (val === null) return null;
		if (indexSuffix !== null && Array.isArray(val)) return [val[indexSuffix] ?? 0];
		return val;
	}

	// `comp("X").layer("Y").text.sourceText`
	const textRef =
		/^(?:comp\(\s*["']([^"']+)["']\s*\)|thisComp)\.layer\(\s*["']([^"']+)["']\s*\)\.text\.sourceText$/.exec(
			core,
		);
	if (textRef) {
		const override = findOverride(ctx.controlOverrides, [textRef[2]!, 'Text']);
		if (override !== null) return override;
		const comp = textRef[1] ? ctx.compositionsByName.get(textRef[1]) : ctx.currentComp;
		const layer = comp?.layers.find((l) => l.name.toLowerCase() === textRef[2]!.toLowerCase());
		if (layer?.textDoc) return layer.textDoc.text;
		return null;
	}

	// `linear(t, tMin, tMax, v1, v2)` / `ease(t, tMin, tMax, v1, v2)` / `clamp(v, lo, hi)`
	const fnCall = /^(linear|ease|clamp)\(([\s\S]+)\)$/.exec(core);
	if (fnCall) {
		const fnName = fnCall[1]!;
		const args = splitTopLevel(fnCall[2]!, ',').map((a) => evaluateExprInternal(a, ctx));
		if (args.some((a) => !a || typeof a === 'string')) return null;
		const numArgs = args as number[][];
		if (fnName === 'clamp' && numArgs.length === 3) {
			const v = numArgs[0]![0] ?? 0;
			const lo = numArgs[1]![0] ?? 0;
			const hi = numArgs[2]![0] ?? 1;
			return [Math.max(lo, Math.min(hi, v))];
		}
		if ((fnName === 'linear' || fnName === 'ease') && numArgs.length === 5) {
			const t = numArgs[0]![0] ?? 0;
			const tMin = numArgs[1]![0] ?? 0;
			const tMax = numArgs[2]![0] ?? 1;
			const v1 = numArgs[3]!;
			const v2 = numArgs[4]!;
			let u = Math.abs(tMax - tMin) > 1e-6 ? (t - tMin) / (tMax - tMin) : 0;
			u = Math.max(0, Math.min(1, u));
			if (fnName === 'ease') u = u * u * (3 - 2 * u);
			const dims = Math.max(v1.length, v2.length);
			const res: number[] = [];
			for (let i = 0; i < dims; i++) {
				const a = v1[i] ?? v1[0] ?? 0;
				const b = v2[i] ?? v2[0] ?? a;
				res.push(a + (b - a) * u);
			}
			return res;
		}
	}

	return null;
}

function splitTopLevel(expr: string, sep: string): string[] {
	const out: string[] = [];
	let depthParen = 0;
	let depthBrack = 0;
	let inQuote: string | null = null;
	let start = 0;

	for (let i = 0; i < expr.length; i++) {
		const ch = expr[i]!;
		if (inQuote) {
			if (ch === '\\') {
				i++;
			} else if (ch === inQuote) {
				inQuote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inQuote = ch;
			continue;
		}
		if (ch === '(') depthParen++;
		else if (ch === ')') depthParen--;
		else if (ch === '[') depthBrack++;
		else if (ch === ']') depthBrack--;
		else if (depthParen === 0 && depthBrack === 0 && expr.startsWith(sep, i)) {
			out.push(expr.slice(start, i).trim());
			start = i + sep.length;
			i += sep.length - 1;
		}
	}
	out.push(expr.slice(start).trim());
	return out;
}

function evaluateBinaryOp(
	lhs: number[],
	rhs: number[],
	op: '+' | '-' | '*' | '/',
): number[] {
	const dims = Math.max(lhs.length, rhs.length);
	const out: number[] = [];
	for (let i = 0; i < dims; i++) {
		const a = lhs[i] ?? lhs[0] ?? 0;
		const b = rhs[i] ?? rhs[0] ?? 0;
		if (op === '+') out.push(a + b);
		else if (op === '-') out.push(a - b);
		else if (op === '*') out.push(a * b);
		else out.push(Math.abs(b) > 1e-9 ? a / b : 0);
	}
	return out;
}

function evaluateExprInternal(expr: string, ctx: ExpressionEvalContext): number[] | string | null {
	let trimmed = expr.trim().replace(/;+$/, '');
	if (!trimmed) return null;

	// Strip outer balanced parentheses
	while (trimmed.startsWith('(') && trimmed.endsWith(')')) {
		let depth = 0;
		let balancedAll = true;
		for (let i = 0; i < trimmed.length; i++) {
			if (trimmed[i] === '(') depth++;
			else if (trimmed[i] === ')') depth--;
			if (depth === 0 && i < trimmed.length - 1) {
				balancedAll = false;
				break;
			}
		}
		if (!balancedAll) break;
		trimmed = trimmed.slice(1, -1).trim();
	}

	// Ternary: `cond ? a : b`
	const qParts = splitTopLevel(trimmed, '?');
	if (qParts.length === 2) {
		const cParts = splitTopLevel(qParts[1]!, ':');
		if (cParts.length === 2) {
			const condStr = qParts[0]!;
			let truthy = false;
			const cmpMatch = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(condStr);
			if (cmpMatch) {
				const l = evaluateExprInternal(cmpMatch[1]!, ctx);
				const r = evaluateExprInternal(cmpMatch[3]!, ctx);
				if (l === null || r === null) return null;
				const lv = Array.isArray(l) ? (l[0] ?? 0) : l;
				const rv = Array.isArray(r) ? (r[0] ?? 0) : r;
				switch (cmpMatch[2]) {
					case '==':
						truthy = lv === rv;
						break;
					case '!=':
						truthy = lv !== rv;
						break;
					case '>':
						truthy = Number(lv) > Number(rv);
						break;
					case '>=':
						truthy = Number(lv) >= Number(rv);
						break;
					case '<':
						truthy = Number(lv) < Number(rv);
						break;
					case '<=':
						truthy = Number(lv) <= Number(rv);
						break;
				}
			} else {
				const cVal = evaluateExprInternal(condStr, ctx);
				if (cVal === null) return null;
				truthy = Array.isArray(cVal) ? (cVal[0] ?? 0) !== 0 : cVal.length > 0;
			}
			return evaluateExprInternal(truthy ? cParts[0]! : cParts[1]!, ctx);
		}
	}

	// Simple `var x = ...; return/expr` multi-statement expressions (common in AE MOGRTs)
	if (trimmed.includes('\n') || trimmed.includes(';')) {
		const lines = trimmed
			.split(/[;\n]+/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length > 1) {
			const env = new Map<string, number[] | string>();
			for (let i = 0; i < lines.length - 1; i++) {
				const assign = /^(?:var|let|const)\s+([a-zA-Z_]\w*)\s*=\s*(.+)$/.exec(lines[i]!);
				if (!assign) return null;
				let rhsStr = assign[2]!;
				for (const [k, v] of env.entries()) {
					const rep = Array.isArray(v) ? (v.length === 1 ? String(v[0]) : `[${v.join(',')}]`) : JSON.stringify(v);
					rhsStr = rhsStr.replace(new RegExp(`\\b${k}\\b`, 'g'), rep);
				}
				const val = evaluateExprInternal(rhsStr, ctx);
				if (val === null) return null;
				env.set(assign[1]!, val);
			}
			let finalExpr = lines[lines.length - 1]!.replace(/^return\s+/, '');
			for (const [k, v] of env.entries()) {
				const rep = Array.isArray(v) ? (v.length === 1 ? String(v[0]) : `[${v.join(',')}]`) : JSON.stringify(v);
				finalExpr = finalExpr.replace(new RegExp(`\\b${k}\\b`, 'g'), rep);
			}
			return evaluateExprInternal(finalExpr, ctx);
		}
	}

	// Try direct atom first
	const direct = evaluateSimpleNumericAtom(trimmed, ctx);
	if (direct !== null) return direct;

	// Binary arithmetic (lowest precedence +,- then *,/)
	for (const ops of [
		['+', '-'] as const,
		['*', '/'] as const,
	]) {
		for (const op of ops) {
			const parts = splitTopLevel(trimmed, ` ${op} `);
			if (parts.length > 1) {
				let acc = evaluateExprInternal(parts[0]!, ctx);
				if (!acc || typeof acc === 'string') return null;
				for (let i = 1; i < parts.length; i++) {
					const rhs = evaluateExprInternal(parts[i]!, ctx);
					if (!rhs || typeof rhs === 'string') return null;
					acc = evaluateBinaryOp(acc, rhs, op);
				}
				return acc;
			}
		}
	}

	return null;
}

/**
 * Evaluates an AE expression string safely against the current frame context and user control overrides.
 */
export function evaluateAeExpression(
	expression: string,
	ctx: ExpressionEvalContext,
): ExpressionEvalResult {
	const cleaned = expression.trim();
	for (const api of UNSUPPORTED_APIS) {
		if (new RegExp(`\\b${api}\\s*\\(`).test(cleaned)) {
			const reason = `API de expressão AE não suportada na Fase 3A: ${api}()`;
			ctx.audit?.unsupported.push({
				compName: ctx.currentComp.name,
				layerName: ctx.currentLayerName,
				expression: cleaned,
				reason,
			});
			return { supported: false, value: ctx.baseValue, reason };
		}
	}

	const evaluated = evaluateExprInternal(cleaned, ctx);
	if (evaluated === null) {
		const reason = 'Expressão fora do subconjunto determinístico de vínculos de controle da Fase 3A.';
		ctx.audit?.unsupported.push({
			compName: ctx.currentComp.name,
			layerName: ctx.currentLayerName,
			expression: cleaned,
			reason,
		});
		return { supported: false, value: ctx.baseValue, reason };
	}

	if (ctx.audit) ctx.audit.supportedEvaluated++;
	return { supported: true, value: evaluated };
}
