const MagicString = require('magic-string');
const walk = require('acorn-walk');
const { toModuleId, toChunkId } = require('./dependency-graph');

/**
 * Transform a module's source code:
 *  - Remove import declarations, replace with loadModule() calls
 *  - Replace imported identifier references with property accesses
 *  - Transform export declarations to plain declarations + defineExports
 *  - Transform dynamic import() to loadChunk().then(...)
 *
 * Returns the transformed source string (just the factory body).
 */
function transformModule(moduleInfo, projectRoot) {
  const s = new MagicString(moduleInfo.source);

  // Collect info we'll need
  const importedBindings = moduleInfo.importedBindings;
  const moduleVarNames = new Map(); // modulePath → variable name (e.g., _math_)

  // --- Step 1: Build module variable names for each import source ---
  for (const imp of moduleInfo.imports) {
    const moduleId = toModuleId(imp.resolvedPath, projectRoot);
    if (!moduleVarNames.has(imp.source)) {
      // Create a readable var name from the file path
      const varName = makeVarName(imp.source);
      moduleVarNames.set(imp.source, varName);
    }
    // Store moduleId on the import for later reference
    imp.moduleId = moduleId;
  }

  // --- Step 2: Remove import declarations, add loadModule() calls at top ---
  const loadModuleCalls = [];

  for (const imp of moduleInfo.imports) {
    const varName = moduleVarNames.get(imp.source);
    const moduleId = imp.moduleId;

    loadModuleCalls.push(`var ${varName} = loadModule("${moduleId}");`);

    // Remove the import declaration from source
    s.remove(imp.node.start, imp.node.end);
  }

  // --- Step 3: Transform export declarations ---
  const exportGetters = []; // { exported, getter }

  for (const exp of moduleInfo.exports.named) {
    if (exp.declarationNode) {
      // export function foo() {} → function foo() {}
      // export const bar = 1 → const bar = 1
      // Remove the 'export ' keyword (from export start to declaration start)
      s.remove(exp.node.start, exp.declarationNode.start);
    } else if (!exp.reexportSource) {
      // export { foo, bar as baz } — remove the entire export statement
      // (the local variables still exist, we just need to expose them)
      // Only remove if this is the first export specifier in the node
      // (avoid double-removal for multiple specifiers in one statement)
      s.remove(exp.node.start, exp.node.end);
    } else {
      // Re-export: export { foo } from './other.js' — remove the statement
      s.remove(exp.node.start, exp.node.end);
    }

    if (exp.reexportSource) {
      // For re-exports, we need to reference the other module
      const moduleId = toModuleId(
        require('path').resolve(
          require('path').dirname(moduleInfo.filePath),
          exp.reexportSource
        ),
        projectRoot
      );
      if (!moduleVarNames.has(exp.reexportSource)) {
        const varName = makeVarName(exp.reexportSource);
        moduleVarNames.set(exp.reexportSource, varName);
        loadModuleCalls.push(`var ${varName} = loadModule("${moduleId}");`);
      }
      const varName = moduleVarNames.get(exp.reexportSource);
      exportGetters.push({
        exported: exp.exported,
        getter: `() => ${varName}.${exp.local}`,
      });
    } else {
      exportGetters.push({
        exported: exp.exported,
        getter: `() => ${exp.local}`,
      });
    }
  }

  // Handle default export
  if (moduleInfo.exports.hasDefault) {
    const defNode = moduleInfo.exports.defaultNode;

    if (moduleInfo.exports.defaultType === 'declaration') {
      // export default function greet() {} → function greet() {}
      const declName = defNode.declaration.id
        ? defNode.declaration.id.name
        : null;

      // Remove 'export default ' prefix
      s.remove(defNode.start, defNode.declaration.start);

      if (declName) {
        exportGetters.push({
          exported: 'default',
          getter: `() => ${declName}`,
        });
      } else {
        // Anonymous default export — assign to a variable
        const varDecl = `var __default_export__ = `;
        s.overwrite(defNode.start, defNode.declaration.start, varDecl);
        exportGetters.push({
          exported: 'default',
          getter: '() => __default_export__',
        });
      }
    } else {
      // export default <expression> → var __default_export__ = <expression>;
      // Need to replace 'export default' with 'var __default_export__ ='
      s.overwrite(
        defNode.start,
        defNode.declaration.start,
        'var __default_export__ = '
      );

      // If the source doesn't end with semicolon, we don't add one (preserve style)
      exportGetters.push({
        exported: 'default',
        getter: '() => __default_export__',
      });
    }
  }

  // --- Step 4: Replace imported identifier references ---
  // Collect all identifier nodes and their ancestor chains
  const replacements = [];

  walk.ancestor(moduleInfo.ast, {
    Identifier(node, ancestors) {
      const binding = importedBindings.get(node.name);
      if (!binding) return;

      // Skip if this identifier is part of an import/export declaration
      const parent = ancestors[ancestors.length - 2];
      if (!parent) return;

      // Skip import specifiers (already removed)
      if (
        parent.type === 'ImportSpecifier' ||
        parent.type === 'ImportDefaultSpecifier' ||
        parent.type === 'ImportNamespaceSpecifier' ||
        parent.type === 'ImportDeclaration'
      ) {
        return;
      }

      // Skip export specifiers
      if (
        parent.type === 'ExportSpecifier'
      ) {
        return;
      }

      // Skip property keys in object expressions/patterns (non-computed)
      if (
        parent.type === 'Property' &&
        parent.key === node &&
        !parent.computed
      ) {
        return;
      }

      // Skip member expression property (non-computed): obj.add → don't touch 'add'
      if (
        parent.type === 'MemberExpression' &&
        parent.property === node &&
        !parent.computed
      ) {
        return;
      }

      // Skip variable declaration names
      if (parent.type === 'VariableDeclarator' && parent.id === node) {
        return;
      }

      // Skip function/class declaration names
      if (
        (parent.type === 'FunctionDeclaration' ||
          parent.type === 'ClassDeclaration') &&
        parent.id === node
      ) {
        return;
      }

      // Skip function parameters
      if (
        (parent.type === 'FunctionDeclaration' ||
          parent.type === 'FunctionExpression' ||
          parent.type === 'ArrowFunctionExpression') &&
        parent.params &&
        parent.params.includes(node)
      ) {
        return;
      }

      // Skip label identifiers
      if (parent.type === 'LabeledStatement' && parent.label === node) {
        return;
      }
      if (parent.type === 'BreakStatement' && parent.label === node) {
        return;
      }
      if (parent.type === 'ContinueStatement' && parent.label === node) {
        return;
      }

      // Build the replacement
      const varName = moduleVarNames.get(binding.modulePath);
      if (!varName) return; // shouldn't happen

      let replacement;
      if (binding.importedName === '*') {
        // Namespace import — just use the variable directly
        replacement = varName;
      } else if (binding.importedName === 'default') {
        replacement = `${varName}["default"]`;
      } else {
        replacement = `${varName}.${binding.importedName}`;
      }

      // Check if this identifier is being called
      const grandparent = ancestors[ancestors.length - 3];
      const isCallTarget =
        parent.type === 'CallExpression' && parent.callee === node;
      const isTaggedTemplate =
        parent.type === 'TaggedTemplateExpression' && parent.tag === node;

      if (isCallTarget || isTaggedTemplate) {
        // Use (0, fn)() pattern to ensure `this` is undefined
        replacement = `(0, ${replacement})`;
      }

      replacements.push({ start: node.start, end: node.end, replacement });
    },
  });

  // Apply replacements in reverse order to preserve positions
  replacements.sort((a, b) => b.start - a.start);
  for (const { start, end, replacement } of replacements) {
    s.overwrite(start, end, replacement);
  }

  // --- Step 5: Transform dynamic imports ---
  for (const dyn of moduleInfo.dynamicImports) {
    if (dyn.resolvedPath) {
      const targetModuleId = toModuleId(dyn.resolvedPath, projectRoot);
      const chunkId = toChunkId(targetModuleId);

      const replacement =
        `loadChunk("${chunkId}").then(loadModule.bind(loadModule, "${targetModuleId}"))`;

      s.overwrite(dyn.node.start, dyn.node.end, replacement);
    }
  }

  // --- Build the final factory body ---
  const lines = [];

  // Add defineExports call at the top
  if (exportGetters.length > 0 || moduleInfo.exports.hasDefault) {
    lines.push('loadModule.markAsESModule(exports);');

    if (exportGetters.length > 0) {
      const getterEntries = exportGetters
        .map(g => `    "${g.exported}": ${g.getter}`)
        .join(',\n');
      lines.push(`loadModule.defineExports(exports, {\n${getterEntries}\n});`);
    }
  } else {
    // Even if no exports, mark as ESModule (webpack always does this for ES modules)
    lines.push('loadModule.markAsESModule(exports);');
  }

  // Add loadModule() calls
  if (loadModuleCalls.length > 0) {
    lines.push(loadModuleCalls.join('\n'));
  }

  // Add the transformed source
  lines.push(s.toString().trim());

  return lines.join('\n\n');
}

/**
 * Create a readable variable name from a module path.
 * "./utils/math.js" → "_utils_math_"
 * "./greet.js" → "_greet_"
 */
function makeVarName(modulePath) {
  return (
    '_' +
    modulePath
      .replace(/^\.\//, '')
      .replace(/\.js$/, '')
      .replace(/[^a-zA-Z0-9]/g, '_') +
    '_'
  );
}

module.exports = { transformModule, makeVarName };
