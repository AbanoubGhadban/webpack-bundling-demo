const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

/**
 * Parse a module file and extract its imports, exports, and dynamic imports.
 *
 * Returns a ModuleInfo object:
 * {
 *   filePath: string,
 *   source: string,
 *   ast: AST,
 *   imports: [{ source, specifiers: [{ local, imported }], node }],
 *   exports: {
 *     named: [{ local, exported, node, declarationNode }],
 *     hasDefault: boolean,
 *     defaultNode: ASTNode | null,
 *     defaultType: 'declaration' | 'expression' | null,
 *   },
 *   dynamicImports: [{ source, node }],
 *   importedBindings: Map<localName, { modulePath, importedName }>
 * }
 */
function parseModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf-8');

  const ast = acorn.parse(source, {
    sourceType: 'module',
    ecmaVersion: 'latest',
    locations: true,
  });

  const imports = [];
  const dynamicImports = [];
  const namedExports = [];
  let hasDefault = false;
  let defaultNode = null;
  let defaultType = null;
  const importedBindings = new Map();

  walk.simple(ast, {
    ImportDeclaration(node) {
      const specifiers = node.specifiers.map(spec => {
        if (spec.type === 'ImportDefaultSpecifier') {
          return { local: spec.local.name, imported: 'default' };
        } else if (spec.type === 'ImportNamespaceSpecifier') {
          return { local: spec.local.name, imported: '*' };
        } else {
          // ImportSpecifier
          return { local: spec.local.name, imported: spec.imported.name };
        }
      });

      imports.push({
        source: node.source.value,
        specifiers,
        node,
      });

      // Build the imported bindings map
      for (const spec of specifiers) {
        importedBindings.set(spec.local, {
          modulePath: node.source.value,
          importedName: spec.imported,
        });
      }
    },

    ExportNamedDeclaration(node) {
      if (node.declaration) {
        // export function foo() {} / export const bar = 1
        if (node.declaration.type === 'FunctionDeclaration') {
          namedExports.push({
            local: node.declaration.id.name,
            exported: node.declaration.id.name,
            node,
            declarationNode: node.declaration,
          });
        } else if (node.declaration.type === 'VariableDeclaration') {
          for (const decl of node.declaration.declarations) {
            namedExports.push({
              local: decl.id.name,
              exported: decl.id.name,
              node,
              declarationNode: node.declaration,
            });
          }
        } else if (node.declaration.type === 'ClassDeclaration') {
          namedExports.push({
            local: node.declaration.id.name,
            exported: node.declaration.id.name,
            node,
            declarationNode: node.declaration,
          });
        }
      }

      if (node.specifiers && node.specifiers.length > 0) {
        // export { foo, bar as baz }
        for (const spec of node.specifiers) {
          namedExports.push({
            local: spec.local.name,
            exported: spec.exported.name,
            node,
            declarationNode: null,
            reexportSource: node.source ? node.source.value : null,
          });
        }
      }
    },

    ExportDefaultDeclaration(node) {
      hasDefault = true;
      defaultNode = node;

      if (
        node.declaration.type === 'FunctionDeclaration' ||
        node.declaration.type === 'ClassDeclaration'
      ) {
        defaultType = 'declaration';
      } else {
        defaultType = 'expression';
      }
    },

    ImportExpression(node) {
      // import('./foo.js') — the source is node.source
      if (node.source.type === 'Literal') {
        dynamicImports.push({
          source: node.source.value,
          node,
        });
      } else {
        // Dynamic expression — we can't statically resolve this
        dynamicImports.push({
          source: null,
          node,
        });
      }
    },
  });

  return {
    filePath,
    source,
    ast,
    imports,
    exports: {
      named: namedExports,
      hasDefault,
      defaultNode,
      defaultType,
    },
    dynamicImports,
    importedBindings,
  };
}

module.exports = { parseModule };
