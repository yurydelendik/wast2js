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
    define('wast2js/wastgenjs', ['exports', 'wast2js/wastparser', 'wast2js/wastvm', 'source-map'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports, require('./wastparser.js'), require('./wastvm.js'), require('source-map'));
  } else {
    factory((root.wast2jsGenjs = {}), root.wast2jsParser, root.wast2jsVM, root.sourceMap);
  }
}(this, function (exports, parser, VM, sourceMap) {
  var SExprAtom = parser.SExprAtom;
  var SExprAtomType = parser.SExprAtomType;
  var vm = VM.vm;
  var SourceMapGenerator = sourceMap.SourceMapGenerator;

  function isName(atom) {
    return atom instanceof SExprAtom && atom.type === SExprAtomType.NAME;
  }

  function isKeyword(atom, name) {
    return atom instanceof SExprAtom && atom.type === SExprAtomType.KEYWORD &&
      (name === undefined || name === atom.value);
  }

  function isInt(atom) {
    return atom instanceof SExprAtom && atom.type === SExprAtomType.INT;
  }

  function resolveName(name, lookup) {
    if (isName(name)) {
      return lookup[name.value];
    } else if (isInt(name)) {
      return name.value;
    } else {
      throw new Error('Invalid var reference');
    }
  }

  var inlined = Object.create(null);
  // Attempts to inline vm op.
  function tryToInlineOp(name, args) {
    var ir;
    if (!(name in inlined)) {
      var fn = vm.ops[name];
      var fnCode = fn.toString();
      var m = /^\s*function\s*\(([^\)]*)\)\s*\{\s*return\s+([^;]+);\s*\}\s*$/.exec(fnCode);
      if (m) {
        var params = m[1].trim();
        ir = {
          params: params ? params.split(/\s*,\s*/g) : [],
          body: m[2]
        };
      } else {
        ir = null;
      }
      inlined[name] = ir;
    } else {
      ir = inlined[name];
    }
    if (!ir) {
      return null;
    }

    return ir.body.replace(/\b(\w)\b/g, function (all, v) {
      var i = ir.params.indexOf(all);
      if (i >= 0) {
        return args[i];
      } else {
        return all;
      }
    });
  }

  // Assigns labels to the all referenced statements.
  function analyzeLabels(stmt) {
    var nextLabelId = 0;
    var label;
    var lookup = new WeakMap();
    var refs = new WeakMap();
    var names = Object.create(null);
    var queue = [{stmt: stmt, prev: null}];
    while (queue.length > 0) {
      var item = queue.shift();
      stmt = item.stmt;
      var prev = item.prev;
      switch (stmt[0].value) {
        case 'block':
        case 'tableswitch':
          prev = stmt;
          if (isName(stmt[1])) {
            label = stmt[1].value;
            names[label] = stmt;
          }
          break;
        case 'loop':
          prev = stmt;
          if (isName(stmt[1])) {
            label = stmt[1].value;
            names[label] = stmt;
            if (isName(stmt[2])) {
              label = stmt[2].value;
              names[label] = stmt[2];
            }
          }
          break;
        case 'br':
        case 'br_if':
          var ref;
          if (isName(stmt[1])) {
            ref = names[stmt[1].value];
          } else {
            var i = stmt[1].value;
            ref = prev;
            while (i > 0) {
              ref = ref.prev;
              i--;
            }
          }
          if (!lookup.has(ref)) {
            lookup.set(ref, 'l' + (nextLabelId++));
          }
          refs.set(stmt, ref);
          break;
      }

      stmt.forEach(function (i) {
        if (Array.isArray(i)) {
          queue.push({stmt: i, prev: prev});
        }
      });
    }
    return {lookup: lookup, refs: refs};
  }

  function generateStatement(stmt, context) {
    if (!isKeyword(stmt[0])) {
      throw new Error('Invalid statement');
    }

    var variable = 'v' + (context.nextVarId++);
    var w = context.writer;
    var label = context.labelsAssigned.lookup.get(stmt);
    if (label) {
      w.writeln(label + ':');
      context.levelsToVar[label] = variable;
    }
    w.addMapping(stmt.source.start);
    switch (stmt[0].value) {
      case 'get_local':
        var localNum = resolveName(stmt[1], context.localsLookup);
        w.write('var ' + variable + ' = ');
        w.addMapping(stmt[1].source.start, isName(stmt[1]) ? stmt[1].value : undefined);
        w.write('local' + localNum);
        w.addMapping(stmt[1].source.end);
        w.writeln(';');
        break;
      case 'set_local':
        var localNum = resolveName(stmt[1], context.localsLookup);
        generateStatement(stmt[2], context);
        w.writeln('var ' + variable + ' = (');
        w.addMapping(stmt[1].source.start, isName(stmt[1]) ? stmt[1].value : undefined);
        w.write('local' + localNum);
        w.addMapping(stmt[1].source.end);
        w.writeln(' = ' + context.lastVar + ');');
        break;
      case 'i32.const':
        w.writeln('var ' + variable + ' = ' + JSON.stringify(stmt[1].value | 0) + ';');
        break;
      case 'i64.const':
      case 'f32.const':
      case 'f64.const':
        w.writeln('var ' + variable + ' = ' + JSON.stringify(stmt[1].value) + ';');
        break;
      case 'block':
        var i = 1;
        if (isName(stmt[i])) {
          i++;
        }
        w.writeln('{');
        w.writeln('var ' + variable + ';');
        for (; i < stmt.length; i++) {
          generateStatement(stmt[i], context);
        }
        w.writeln(variable + ' = ' + context.lastVar + ';');
        w.writeln('}');
        break;
      case 'loop':
        var i = 1, label2;
        if (isName(stmt[i])) {
          i++;
        }
        if (isName(stmt[i])) {
          label2 = context.labelsAssigned.lookup.get(stmt[i]);
          i++;
        }
        w.writeln('while (1) {');
        w.writeln('var ' + variable + ';');
        if (label2) {
          w.writeln(label2 + ': {');
        }
        for (; i < stmt.length; i++) {
          generateStatement(stmt[i], context);
        }
        w.writeln(variable + ' = ' + context.lastVar + ';');
        w.writeln('break;');
        if (label2) {
          w.writeln('}');
        }
        w.writeln('}');
        break;
      case 'tableswitch':
        var i = 1;
        if (isName(stmt[i])) {
          i++;
        }
        w.writeln('{');
        w.writeln('var ' + variable + ';');
        generateStatement(stmt[i], context);
        i++;
        w.writeln('switch (' + context.lastVar + ') {');

        var table;
        if (isKeyword(stmt[i][0], 'table')) {
          table = stmt[i];
          i++;
        }
        var defaultCase = stmt[i++];
        if (table) {
          for (var j = 1; j < table.length; j++) {
            if (isKeyword(table[j][0], 'br')) {
              w.writeln('case ' + (j - 1) + ':');
              generateStatement(table[j], context);
            }
          }
        }
        if (isKeyword(defaultCase[0], 'br')) {
          w.writeln('default:');
          generateStatement(defaultCase, context);
        }
        var caseFound = false;
        for (; i < stmt.length; i++) {
          var caseStmt = stmt[i];
          var q = 1;
          var caseName = null;
          if (caseStmt.length > q && isName(caseStmt[1])) {
            caseName = caseStmt[q].value;
            q++;
          }
          if (table) {
            for (var j = 1; j < table.length; j++) {
              var match = false;
              if (isKeyword(table[j][0], 'case')) {
                if (isName(table[j][1])) {
                  match = caseName && (caseName === table[j][1].value)
                } else {
                  match = (j - 1) === table[j][1].value;
                }
              }
              if (match) {
                w.writeln('case ' + (j - 1) + ':');
                caseFound = true;
              }
            }
          }
          if (isKeyword(defaultCase[0], 'case')) {
            var match = false;
            if (isName(defaultCase[1])) {
              match = caseName && (caseName === defaultCase[1].value)
            } else {
              match = (j - 1) === defaultCase[1].value;
            }
            if (match) {
              w.writeln('default:');
              caseFound = true;
            }
          }
          if (!caseFound) {
            continue;
          }
          for (; q < caseStmt.length; q++) {
            generateStatement(caseStmt[q], context);
          }
        }
        if (caseFound) {
          w.writeln(variable + ' = ' + context.lastVar + ';');
        }

        w.writeln('}');
        w.writeln('}');
        break;
      case 'br':
        var ref = context.labelsAssigned.refs.get(stmt);
        var label = context.labelsAssigned.lookup.get(ref);
        if (stmt.length > 2) {
          generateStatement(stmt[2], context);
          w.writeln(context.levelsToVar[label] + ' = ' + context.lastVar + ';');
        }
        w.writeln('break ' + label + ';');
        break;
      case 'br_if':
        var ref = context.labelsAssigned.refs.get(stmt);
        var label = context.labelsAssigned.lookup.get(ref);

        generateStatement(stmt[2], context);
        if (stmt.length > 3) {
          w.writeln(context.levelsToVar[label] + ' = ' + context.lastVar + ';');
          generateStatement(stmt[3], context);
        }
        w.writeln('if (' + context.lastVar + ') { break ' + label + '; }');
        break;
      case 'if':
        w.writeln('{');
        generateStatement(stmt[1], context);
        w.writeln('if (' + context.lastVar + ') {');
        generateStatement(stmt[2], context);
        w.writeln('}');
        w.writeln('}');
        break;
      case 'if_else':
        w.writeln('{');
        w.writeln('var ' + variable + ';');
        generateStatement(stmt[1], context);
        w.writeln('if (' + context.lastVar + ') {');
        generateStatement(stmt[2], context);
        w.writeln(variable + ' = ' + context.lastVar + ';', '} else {');
        generateStatement(stmt[3], context);
        w.writeln(variable + ' = ' + context.lastVar + ';', '}');
        w.writeln('}');
        break;
      case 'return':
        if (stmt.length > 1) {
          generateStatement(stmt[1], context);
        }
        if (context.hasResult) {
          w.writeln('return ' + context.lastVar + ';');
        } else {
          w.writeln('return;');
        }
        break;
      case 'call':
        var args = [];
        for (var j = 2; j < stmt.length; j++) {
          generateStatement(stmt[j], context);
          args.push(context.lastVar);
        }
        var functionId = resolveName(stmt[1], context.functionsLookup);
        w.writeln('var ' + variable + ' = func' + functionId + '(' + args.join(', ') + ');');
        break;
      case 'invoke':
        var args = ['null'];
        for (var j = 2; j < stmt.length; j++) {
          generateStatement(stmt[j], context);
          args.push(context.lastVar);
        }
        var importedName = stmt[1].value;
        w.writeln('var ' + variable + ' = imported[' + JSON.stringify(importedName) + '].call(' + args.join(', ') + ');');
        break;
      case 'assert_return':
        w.writeln('vm.assertReturn(function () {');
        generateStatement(stmt[1], context);
        w.writeln('var result1 = ' + context.lastVar + ';');
        generateStatement(stmt[2], context);
        w.writeln('var result2 = ' + context.lastVar + ';');
        w.writeln('return [result1, result2];');
        w.writeln('}, ' + stmt.source.start.line + ');');
        break;
      case 'assert_return_nan':
        w.writeln('vm.assertReturnNaN(function () {');
        generateStatement(stmt[1], context);
        w.writeln('return ' + context.lastVar + ';');
        w.writeln('}, ' + stmt.source.start.line + ');');
        break;
      case 'assert_trap':
        w.writeln('vm.assertTrap(function () {');
        generateStatement(stmt[1], context);
        w.writeln('}, ' + JSON.stringify(stmt[2].value) + ', ' + stmt.source.start.line + ');');
        break;
      default:
        var opName = stmt[0].value;
        if (!(opName in vm.ops)) {
          throw new Error('Unsupported operation: ' + opName);
        }
        var args = [];
        for (var j = 1; j < stmt.length; j++) {
          generateStatement(stmt[j], context);
          args.push(context.lastVar);
        }
        var maybeInlined = tryToInlineOp(opName, args);
        if (maybeInlined) {
          w.writeln('var ' + variable + ' = ' + maybeInlined + ';');
        } else {
          args.unshift('null');
          w.writeln('var ' + variable + ' = vm.ops[' + JSON.stringify(opName) + '].call(' + args.join(', ') + ');');
        }
        break;
    }
    w.addMapping(stmt.source.end);
    context.lastVar = variable;
  }

  function generateFunc(func, w, functionsLookup) {
    var i = 1;
    if (isName(func[i])) {
      i++;
    }
    w.addMapping(func.source.start);
    var localsLookup = {};
    var nextLocalId = 0;
    var hasResult = false;
    var hasParams = false;
    w.write('function (');
    while (i < func.length && isKeyword(func[i][0], 'param')) {
      var params = func[i++];
      if (isName(params[1])) {
        if (hasParams) {
          w.write(', ');
        }
        localsLookup[params[1].value] = nextLocalId;
        w.addMapping(params.source.start, params[1].value);
        w.write('local' + (nextLocalId++));
        w.addMapping(params.source.end);
        hasParams = true;
      } else {
        for (var j = 1; j < params.length; j++) {
          if (hasParams) {
            w.write(', ');
          }
          w.write('local' + (nextLocalId++));
          hasParams = true;
        }
      }
    }
    if (i < func.length && isKeyword(func[i][0], 'result')) {
      hasResult = true;
      i++;
    }
    w.writeln(') {');
    var hasLocals = false;
    while (i < func.length && isKeyword(func[i][0], 'local')) {
      var local = func[i++];
      if (isName(local[1])) {
        if (hasLocals) {
          w.write(', ');
        } else {
          w.write('var ');
        }
        localsLookup[local[1].value] = nextLocalId;
        w.addMapping(local.source.start, local[1].value);
        w.write('local' + (nextLocalId++));
        w.addMapping(local.source.end);
        hasLocals = true;
      } else {
        for (var j = 1; j < local.length; j++) {
          if (hasLocals) {
            w.write(', ');
          } else {
            w.write('var ');
          }
          w.write('local' + (nextLocalId++));
          hasLocals = true;
        }
      }
    }
    if (hasLocals) {
      w.writeln(';');
    }
    if (false && (hasLocals || hasParams)) {
      w.write('var __locals = Object.create(null, {');
      Object.keys(localsLookup).forEach(function (key, index) {
        if (index > 0) {
          w.write(',');
        }
        w.write(JSON.stringify('$' + key) + ':{get: function () {return local' + localsLookup[key] + ';}, enumerable: true}');
      });
      w.writeln('});');
    }

    var context = {
      writer: w,
      functionsLookup: functionsLookup,
      localsLookup: localsLookup,
      hasResult: hasResult,
      nextVarId: 0,
      levelsToVar: Object.create(null),
      labelsAssigned: analyzeLabels(func),
      lastVar: ''
    };
    for (; i < func.length; i++) {
      generateStatement(func[i], context);
    }
    if (hasResult) {
      w.writeln('return ' + context.lastVar + ';');
    }

    w.write('}');
    w.addMapping(func.source.end);
  }

  function generateModule(module, w) {
    w.writeln('(function () {');
    w.writeln('var module = {}, imported = {};');
    var functionsLookup = {};
    var functions = [];
    for (var i = 1; i < module.length; i++) {
      var moduleItem = module[i];
      var id = moduleItem[0].value;
      if (id === 'func') {
        if (isName(moduleItem[1])) {
          var name = moduleItem[1].value;
          functionsLookup[name] = functions.length; // index
        }
        functions.push(moduleItem);
      }
    }
    functions.forEach(function (moduleItem, index) {
      w.write('var func' + index + ' = ');
      generateFunc(moduleItem, w, functionsLookup);
      w.writeln(';');
    });
    for (var i = 1; i < module.length; i++) {
      var moduleItem = module[i];
      var id = moduleItem[0].value;
      if (id === 'export') {
        var refFunctionId = resolveName(moduleItem[2], functionsLookup);
        w.writeln('module[' + JSON.stringify(moduleItem[1].value) + '] = func' + refFunctionId + ';');
      }
    }
    w.writeln('return module;');
    w.write('})()');
  }

  function generateTestOperations(ops, w) {
    w.writeln('(function (module) {');
    w.writeln('var imported = module;');
    ops.forEach(function (op) {
      if (isKeyword(op[0], 'assert_invalid')) {
        return; // ignore assert_invalid
      }

      var context = {
        writer: w,
        functionsLookup: {},
        localsLookup: {},
        hasResult: false,
        nextVarId: 0,
        levelsToVar: Object.create(null),
        labelsAssigned: analyzeLabels(op),
        lastVar: ''
      };

      generateStatement(op, context);
    });
    w.writeln('})(currentModule);');
  }

  function JSSourceWriter(filename, sourceRoot) {
    this.buffer = '';
    this.line = 0;
    this.pos = 0;
    this.filename = filename;
    this.map = new SourceMapGenerator({
      file: filename + '.js',
      sourceRoot: sourceRoot
    });
  }

  JSSourceWriter.prototype = {
    write: function (s) {
      var i = s.lastIndexOf('\n');
      if (i < 0) {
        this.pos += s.length;
      } else {
        this.pos = s.length - i - 1;
        this.line += s.split('\n').length - 1;
      }
      this.buffer += s;
    },
    writeln: function (s) {
      if (s) {
        this.write(s);
      }
      this.pos = 0;
      this.line++;
      this.buffer += '\n';
    },
    addMapping: function (sourcePos, name) {
      this.map.addMapping({
        generated: {
          line: this.line,
          column: this.pos
        },
        source: this.filename,
        original: {
          line: sourcePos.line,
          column: sourcePos.pos
        },
        name: name
      });
    },
    getMap: function () {
      return this.map;
    },
    toString: function () {
      return this.buffer;
    }
  };

  function generateJS(ast, sourceParams) {
    var i = 0;
    var w = new JSSourceWriter(sourceParams.filename, sourceParams.sourceRoot);
    w.writeln('var vm = wast2jsVM.vm;');
    while (i < ast.length) {
      var item = ast[i];
      if (isKeyword(item[0], 'module')) {
        w.write('var currentModule = ');
        generateModule(item, w);
        w.writeln(';');
        i++;
        continue;
      }
      var j = i;
      while (i < ast.length && !isKeyword(ast[i][0], 'module')) {
        i++;
      }
      generateTestOperations(ast.slice(j, i), w);
    }
    return {output: w.toString(), map: w.getMap().toJSON()};
  }

  exports.generateJS = generateJS;
}));