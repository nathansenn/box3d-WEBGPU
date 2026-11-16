// Values a caller can pass by mistake or on purpose. Each list names what a parameter of that kind must refuse.
export const FLOAT32_MAX = 3.4028234663852886e38;
/** Not numbers at all. */
export const WRONG_TYPES = [null, 'x', '', '1', {}, [], true, 1n, Symbol.for('fuzz'), () => 1, new Float32Array(1), {valueOf: () => 1}];
/** Numbers no solver can hold: not finite, or outside float32. */
export const NON_FINITE = [NaN, Infinity, -Infinity, 1e39, -1e39, Number.MAX_VALUE, -Number.MAX_VALUE];
/** Refused where a strictly positive value is required: zero, negatives and values float32 rounds to zero. */
export const NON_POSITIVE = [0, -0, -1, -1e-9, 1e-50, -Number.MIN_VALUE, Number.MIN_VALUE];
/** Legal float32 values at the edge of the range; a solver may accept or refuse them, but must stay finite. */
export const EXTREME = [1e30, -1e30, FLOAT32_MAX, -FLOAT32_MAX, 1e-38, 2 ** 53, -(2 ** 53), 1e12, -1e12, 1e6, -1e6, 1e5, -1e5, 1e3, -1e3, 1e-9, 1e-12, 1e-4];
/** Vectors of the wrong shape. */
export const BAD_VECTORS = [[], [0], [0, 0], [0, 0, 0, 0, 0], [NaN, 0, 0], [0, Infinity, 0], [0, 0, 1e39], ['a', 0, 0], [0, undefined, 0], [0, , 0], {x: 0, y: 0}, {x: NaN, y: 0, z: 0}, {x: 'a', y: 0, z: 0}, 'abc', 7, null, new Float32Array(2), [[0, 0, 0]], [0n, 0n, 0n]];
export const BAD_QUATS = [[], [0, 0, 0], [0, 0, 0, 0], [NaN, 0, 0, 1], [0, 0, 0, Infinity], [1e39, 0, 0, 1], ['a', 0, 0, 1], {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: NaN}, 'abcd', 7, null, [0, 0, 0, 1, 0]];
/** Keys that must never reach an object's prototype. */
export const POLLUTION_KEYS = ['__proto__', 'constructor', 'prototype'];

export const describe = value => {
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function') return 'function';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.length})`;
  try { return JSON.stringify(value, (_, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : typeof v === 'bigint' ? `${v}n` : v) ?? String(value); } catch { return Object.prototype.toString.call(value); }
};
