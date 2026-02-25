const path = require('path');
const fs = require('fs');

const EXTENSIONS = ['', '.js', '.json', '/index.js'];

/**
 * Resolve a module specifier to an absolute file path.
 * Only handles relative paths (no node_modules resolution).
 */
function resolveModule(specifier, fromDir) {
  if (!specifier.startsWith('.')) {
    throw new Error(
      `Cannot resolve bare specifier "${specifier}". Only relative paths are supported.`
    );
  }

  const basePath = path.resolve(fromDir, specifier);

  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(
    `Cannot resolve module "${specifier}" from "${fromDir}". Tried:\n` +
    EXTENSIONS.map(ext => `  ${basePath}${ext}`).join('\n')
  );
}

module.exports = { resolveModule };
