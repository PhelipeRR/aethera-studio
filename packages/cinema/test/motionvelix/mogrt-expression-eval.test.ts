/** The expression forms found in real Essential Graphics templates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	evaluateAeExpression,
	type ExpressionEvalContext,
	type ExpressionPropertyRef,
} from '../../src/motionvelix/mogrt-expression-eval.js';

const CONTROLS: Record<string, number[]> = {
	Colour: [1, 0.25, 1, 1],
	Enabled: [1],
	Disabled: [0],
	Size: [135],
	Point: [59.5, 90.75],
	Freq: [15],
	Amp: [5],
};

function context(overrides: Partial<ExpressionEvalContext> = {}): ExpressionEvalContext {
	return {
		tSec: 1.26,
		valueAt: (tSec) => [tSec, 20, 30],
		resolveProperty: (ref: ExpressionPropertyRef) => CONTROLS[String(ref.effect)],
		...overrides,
	};
}

function evaluate(expression: string, overrides?: Partial<ExpressionEvalContext>): number[] {
	const result = evaluateAeExpression(expression, context(overrides));
	assert.equal(result.supported, true, result.reason);
	return result.value;
}

test('reads a control through comp().layer().effect()(matchName)', () => {
	const refs: ExpressionPropertyRef[] = [];
	const value = evaluate('comp("Main").layer("Controls").effect("Colour")("ADBE Color Control-0001")', {
		resolveProperty: (ref) => {
			refs.push(ref);
			return CONTROLS.Colour;
		},
	});
	assert.deepEqual(value, [1, 0.25, 1, 1]);
	assert.deepEqual(refs, [{ comp: 'Main', layer: 'Controls', effect: 'Colour', param: 'ADBE Color Control-0001' }]);
});

test('if/else with value', () => {
	const template = (name: string): string => `if(effect("${name}")("Checkbox") > 0 ) {value} else {0}`;
	assert.deepEqual(evaluate(template('Enabled')), [1.26, 20, 30]);
	assert.deepEqual(evaluate(template('Disabled')), [0]);
});

test('assignment without var, CR line endings and array result', () => {
	assert.deepEqual(evaluate('temp = effect("Size")("Slider");\r[temp, temp]'), [135, 135]);
});

test('a trailing assignment is the result', () => {
	assert.deepEqual(evaluate('temp = effect("Point")("Point");'), [59.5, 90.75]);
});

test('var, thisComp, indexing and arithmetic', () => {
	assert.deepEqual(evaluate('var s = thisComp.layer("Controls").effect("Size")("Slider"); [value[1], -s * 2 + 1]'), [20, -269]);
});

test('time', () => {
	assert.deepEqual(evaluate('time * 150'), [189]);
});

test('posterizeTime quantizes time and value', () => {
	const [time, value] = evaluate('posterizeTime(12);\r\n[time, value[0]]');
	assert.equal(time, 1.25);
	assert.equal(value, 1.25);
});

test('wiggle is deterministic, bounded and flagged as an approximation', () => {
	const expression = 'a = effect("Freq")("Slider");\r\nb = effect("Amp")("Slider");\r\n\r\nwiggle(a, b);';
	const first = evaluateAeExpression(expression, context());
	const second = evaluateAeExpression(expression, context());
	assert.equal(first.supported, true);
	assert.equal(first.approximated, true);
	assert.deepEqual(first.value, second.value);
	[1.26, 20, 30].forEach((base, i) => assert.ok(Math.abs(first.value[i]! - base) <= 5));
});

for (const expression of [
	'loopOut("cycle")',
	'effect("Missing")("Slider")',
	'value.constructor',
	'constructor("return process")()',
	'__proto__',
	'while (true) {}',
	'(',
	`${'('.repeat(500)}1${')'.repeat(500)}`,
]) {
	test(`unsupported input keeps the value and says why: ${expression.slice(0, 32)}`, () => {
		const result = evaluateAeExpression(expression, context());
		assert.equal(result.supported, false);
		assert.deepEqual(result.value, [1.26, 20, 30]);
		assert.ok(result.reason);
	});
}
