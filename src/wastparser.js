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
    define('wast2js/wastparser', ['exports'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports);
  } else {
    factory((root.wast2jsParser = {}));
  }
}(this, function (exports) {
  function SExprAtomLocation(line, pos) {
    this.line = line;
    this.pos = pos;
  }

  var SExprAtomType = {
    TEXT: 'text',
    NAME: 'name',
    INT: 'int',
    FLOAT: 'float',
    KEYWORD: 'keyword'
  };

  function SExprAtom(type, value) {
    this.type = type;
    this.value = value;
    this.source = { start: null, end: null };
  }

  /**
   * Parser WAST (s-expression) format. Produces result in form of nested arrays
   * and atom objects (keyword, numerical or string constants). Every array
   * and object has "source" property attached, which refers source location.
   * @param s
   * @returns {Array}
   */
  function parseWAST(s) {
    // true if current s[i] is whitespace
    function isWS() {
      var ch = s[i];
      return ch === ' ' || ch === '\n' || ch === '\t';
    }

    // skips all whitespaces and comments.
    function skipWS() {
      while (i < s.length && isWS()) {
        if (s[i] === '\n') {
          currentLine++;
          currentLineStart = i + 1;
        }
        i++;
      }
      while (i + 1 < s.length && s[i + 1] === ';' &&
      (s[i] === ';' || s[i] === '(')) {
        if (s[i] === ';') {
          while (i < s.length && s[i] !== '\n') {
            i++;
          }
        } else {
          while (i + 1 < s.length && (s[i] !== ';' || s[i + 1] !== ')')) {
            if (s[i] === '\n') { // can it be multiline?
              currentLine++;
              currentLineStart = i + 1;
            }
            i++;
          }
          i += 2;
        }
        while (i < s.length && isWS()) {
          if (s[i] === '\n') {
            currentLine++;
            currentLineStart = i + 1;
          }
          i++;
        }
      }
    }

    if (s.indexOf('\r') >= 0) {
      // Hacking for windows CRLF format -- replacing all with LF.
      s = s.replace(/\r\n?/g, '\n');
    }

    var currentLine = 1;
    var currentLineStart = 0;

    var i = 0;
    skipWS();
    var stack = [];
    var top = [];
    var atomObj;
    while (i < s.length) {
      var ch = s[i++];
      if (ch === '(') {
        stack.push(top);
        top = [];
        top.source = {
          start: new SExprAtomLocation(currentLine, i - 1 - currentLineStart),
          end: null
        };
        stack[stack.length - 1].push(top);
      } else if (ch === ')') {
        top.source.end = new SExprAtomLocation(currentLine, i - currentLineStart);
        top = stack.pop();
      } else if (ch === '"') {
        var j = i, line = currentLine, lineStart = currentLineStart;
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\n') {
            line++;
            lineStart = j + 1;
          }
          if (s[j] === '\\') {
            j++;
            if (s[j] === '\n') {
              line++;
              lineStart = j + 1;
            }
          }
          j++;
        }
        j++;
        var string = JSON.parse(s.substring(i - 1, j));
        atomObj = new SExprAtom(SExprAtomType.TEXT, string);
        atomObj.start = new SExprAtomLocation(currentLine, i - currentLineStart);
        atomObj.end = new SExprAtomLocation(line, i - lineStart);
        top.push(atomObj);
        i = j;
        currentLine = line;
        currentLineStart = lineStart;
      } else {
        var q = i - 1;
        while (i < s.length && !(isWS() || s[i] === '(' || s[i] === ')' ||
        (s[i] === ';' && s[i + 1] === ';'))) {
          i++;
        }
        var atom = s.substring(q, i);
        if (ch === '-' || ch === '+' || (ch >= '0' && ch <= '9')) {
          if (atom.indexOf('.') < 0 && atom.indexOf('e') < 0 &&
            atom.indexOf('E') < 0 && atom.indexOf('p') < 0 &&
            atom.indexOf('n') < 0) {
            atomObj = new SExprAtom(SExprAtomType.INT, parseWASTInt(atom));
            atomObj.text = atom;
          } else {
            atomObj = new SExprAtom(SExprAtomType.FLOAT, parseWASTFloat(atom));
            atomObj.text = atom;
          }
        } else if (atom === 'infinity' ||
                   atom === 'nan' || atom.indexOf('nan:') === 0) {
          atomObj = new SExprAtom(SExprAtomType.FLOAT, parseWASTFloat(atom));
          atomObj.text = atom;
        } else if (ch === '$') {
          atomObj = new SExprAtom(SExprAtomType.NAME, atom.substring(1));
        } else {
          atomObj = new SExprAtom(SExprAtomType.KEYWORD, atom);
        }
        atomObj.source.start = new SExprAtomLocation(currentLine, q - currentLineStart);
        atomObj.source.end = new SExprAtomLocation(currentLine, i - currentLineStart);
        top.push(atomObj);
      }
      skipWS();
    }
    return top;
  }

  function parseWASTFloat(s) {
    switch (s) {
      case 'nan':
      case '+nan':
        return Number.NaN;
      case 'infinity':
      case '+infinity':
        return Number.POSITIVE_INFINITY;
      case '-infinity':
        return Number.NEGATIVE_INFINITY;
    }
    if (s.indexOf('nan') >= 0) {
      return Number.NaN; // TODO -nan and nan:0x... formats
    }
    if (s.indexOf('0x') >= 0) {
      var parts = s.split('p');
      var num = parts[0];
      var j = num.indexOf('.');
      var power = 0;
      if (j >= 0) {
        power = (j - num.length + 1) << 2;
        num = num.replace(/\./g, '');
      }
      if (parts.length > 1) {
        power += +parts[1];
      }
      var result = parseWASTInt(num);
      while (power < 0) {
        result /= 2;
        power++;
      }
      while (power > 0) {
        result *= 2;
        power--;
      }
      return result;
    }
    return +s;
  }

  function parseWASTInt(s) {
    // TODO ints may overflow here.
    if (s[0] === '-') {
      return -s.substring(1);
    }
    if (s[0] === '+') {
      return +s.substring(1);
    }
    return +s;
  }


  exports.SExprAtom = SExprAtom;
  exports.SExprAtomType = SExprAtomType;
  exports.parseWAST = parseWAST;
}));