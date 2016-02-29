/* Copyright 2016 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('wast2js/wastvm', ['exports'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    factory((root.wast2jsVM = {}));
  }
}(this, function (exports) {
  // Simple support of WAST operators.
  var vm = {
    ops: {
      "i32.add": function (a, b) {
        return (a + b) | 0;
      },
      "i32.sub": function (a, b) {
        return (a - b) | 0;
      },
      "i32.mul": function (a, b) {
        return Math.imul(a, b) | 0;
      },
      "i32.div_s": function (a, b) {
        return (a / b) | 0;
      },
      "i32.div_u": function (a, b) {
        return ((a >>> 0) / (b >>> 0)) | 0;
      },
      "i32.rem_s": function (a, b) {
        return (a % b) | 0;
      },
      "i32.rem_u": function (a, b) {
        return ((a >>> 0) % (b >>> 0)) | 0;
      },
      "i32.and": function (a, b) {
        return a & b;
      },
      "i32.or": function (a, b) {
        return a | b;
      },
      "i32.xor": function (a, b) {
        return a ^ b;
      },
      "i32.shl": function (a, b) {
        return a << b;
      },
      "i32.shr_s": function (a, b) {
        return a >> b;
      },
      "i32.shr_u": function (a, b) {
        return a >>> b;
      },
      "i32.eq": function (a, b) {
        return a === b ? 1 : 0;
      },
      "i32.ne": function (a, b) {
        return a !== b ? 1 : 0;
      },
      "i32.lt_s": function (a, b) {
        return a < b ? 1 : 0;
      },
      "i32.lt_u": function (a, b) {
        return (a >>> 0) < (b >>> 0) ? 1 : 0;
      },
      "i32.le_s": function (a, b) {
        return a <= b ? 1 : 0;
      },
      "i32.le_u": function (a, b) {
        return (a >>> 0) <= (b >>> 0) ? 1 : 0;
      },
      "i32.gt_s": function (a, b) {
        return a > b ? 1 : 0;
      },
      "i32.gt_u": function (a, b) {
        return (a >>> 0) > (b >>> 0) ? 1 : 0;
      },
      "i32.ge_s": function (a, b) {
        return a >= b ? 1 : 0;
      },
      "i32.ge_u": function (a, b) {
        return (a >>> 0) >= (b >>> 0) ? 1 : 0;
      },
      "i32.clz": function (a) {
        return 0;
      },
      "i32.ctz": function (a) {
        return 0;
      },
      "i32.popcnt": function (a) {
        return 0;
      },

      "f32.add": function (a, b) {
        return Math.fround(a + b);
      },
      "f32.sub": function (a, b) {
        return Math.fround(a - b);
      },
      "f32.mul": function (a, b) {
        return Math.fround(a * b);
      },
      "f32.div": function (a, b) {
        return Math.fround(a / b);
      },
      "f32.sqrt": function (x) {
        return Math.fround(Math.sqrt(x));
      },
      "f32.min": function (a, b) {
        return Math.min(a, b);
      },
      "f32.max": function (a, b) {
        return Math.max(a, b);
      },
      "f32.ceil": function (x) {
        return Math.fround(Math.ceil(x));
      },
      "f32.floor": function (x) {
        return Math.fround(Math.floor(x));
      },
      "f32.trunc": function (x) {
        return Math.fround(Math.trunc(x));
      },
      "f32.nearest": function (x) {
        return Math.fround(Math.round);
      },
      "f32.abs": function (x) {
        return Math.fround(Math.abs(x));
      },
      "f32.neg": function (x) {
        return Math.fround(-x);
      },
      "f32.copysign": function (a, b) {
        return (a < 0) === (b < 0) ? a : -a;
      },
    },
    assertReturn: function (fn, line) {
      try {
        var result = fn();
        if (result[0] === result[1]) {
          console.log('PASS');
        } else {
          console.error('FAIL: ' + 'actual: ' + result[0] + ', expected: ' + result[1] + ', at ' + line);
        }
      } catch (e) {
        console.error('FAIL (exception): ' + e + ', at ' + line);
      }
    },
    assertReturnNaN: function (fn, line) {
      try {
        var result = fn();
        if (isNaN(result)) {
          console.log('PASS');
        } else {
          console.error('FAIL: ' + 'actual: ' + result + ', expected: NaN, at ' + line);
        }
      } catch (e) {
        console.error('FAIL (exception): ' + e + ', at ' + line);
      }
    },
    assertTrap: function (fn, exception, line) {
      try {
        fn();
        console.error('FAIL: no exception, at ' + line);
      } catch (e) {
        if (e !== exception) {
          console.error('FAIL (exception): ' + e + ', at ' + line);
        } else {
          console.log('PASS');
        }
      }
    },
  };

  exports.vm = vm;
}));

