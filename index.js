var fs = require('fs');
var parser = require('./src/wastparser.js');
var genjs = require('./src/wastgenjs.js');

var args = process.argv;
if (args.length < 4) {
  console.log('Usage: node wast2js <input-wast-file> <output-js-file-base>');
  process.exit(1);
}

var inputFile = args[2];
var outputFile = args[3];

var ast = parser.parseWAST(fs.readFileSync(inputFile).toString());
var generated = genjs.generateJS(ast, {filename: inputFile});

fs.writeFileSync(outputFile, generated.output + '//# sourceMappingURL=' + outputFile + '.map');
fs.writeFileSync(outputFile + '.map', JSON.stringify(generated.map));
