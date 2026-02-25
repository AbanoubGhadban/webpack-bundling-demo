const path = require('path');
const { parseModule } = require('./parser');
const { resolveModule } = require('./resolver');

/**
 * Build the full dependency graph starting from an entry file.
 * Returns a Map of absolute paths to ModuleInfo objects.
 */
function buildDependencyGraph(entryPath) {
  const graph = new Map();
  const queue = [entryPath];

  while (queue.length > 0) {
    const filePath = queue.shift();

    if (graph.has(filePath)) continue;

    const moduleInfo = parseModule(filePath);
    graph.set(filePath, moduleInfo);

    // Follow static imports
    for (const imp of moduleInfo.imports) {
      const resolved = resolveModule(imp.source, path.dirname(filePath));
      imp.resolvedPath = resolved;
      if (!graph.has(resolved)) {
        queue.push(resolved);
      }
    }

    // Follow dynamic imports
    for (const dyn of moduleInfo.dynamicImports) {
      if (dyn.source) {
        const resolved = resolveModule(dyn.source, path.dirname(filePath));
        dyn.resolvedPath = resolved;
        if (!graph.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }

  return graph;
}

/**
 * Convert an absolute file path to a module ID (relative to project root).
 * Example: /home/user/project/src/utils/math.js → "./src/utils/math.js"
 */
function toModuleId(absolutePath, projectRoot) {
  const rel = path.relative(projectRoot, absolutePath);
  return './' + rel.split(path.sep).join('/');
}

/**
 * Convert a module ID to a chunk ID.
 * Example: "./src/feature-a.js" → "src_feature-a_js"
 */
function toChunkId(moduleId) {
  return moduleId
    .replace(/^\.\//, '')
    .replace(/[/\\]/g, '_')
    .replace(/\./g, '_')
    .replace(/_js$/, '_js');
}

/**
 * Identify chunks from the dependency graph.
 *
 * Returns:
 * {
 *   mainChunk: { id: 'main', moduleIds: Set<string> },
 *   lazyChunks: Map<chunkId, { id: string, moduleIds: Set<string>, entryModuleId: string }>,
 *   chunkGroupMap: { [chunkId]: string[] },
 *   modules: Map<moduleId, transformedModuleInfo>,
 * }
 */
function identifyChunks(graph, entryPath, projectRoot) {
  const entryModuleId = toModuleId(entryPath, projectRoot);

  // Map absolute paths → module IDs, and build a moduleId-keyed info map
  const modules = new Map();
  for (const [absPath, info] of graph) {
    const moduleId = toModuleId(absPath, projectRoot);
    info.moduleId = moduleId;
    modules.set(moduleId, info);
  }

  // --- Step 1: Main chunk — BFS following only static imports from entry ---
  const mainModuleIds = new Set();
  const mainQueue = [entryModuleId];

  while (mainQueue.length > 0) {
    const modId = mainQueue.shift();
    if (mainModuleIds.has(modId)) continue;
    mainModuleIds.add(modId);

    const info = modules.get(modId);
    if (!info) continue;

    for (const imp of info.imports) {
      const depId = toModuleId(imp.resolvedPath, projectRoot);
      if (!mainModuleIds.has(depId)) {
        mainQueue.push(depId);
      }
    }
  }

  // --- Step 2: Lazy chunks — each dynamic import starts a new chunk ---
  const lazyChunks = new Map();
  const dynamicEntryPoints = new Map(); // moduleId → chunkId

  // Collect all dynamic import targets
  for (const [, info] of modules) {
    for (const dyn of info.dynamicImports) {
      if (dyn.resolvedPath) {
        const targetId = toModuleId(dyn.resolvedPath, projectRoot);
        const chunkId = toChunkId(targetId);
        dynamicEntryPoints.set(targetId, chunkId);
      }
    }
  }

  // For each dynamic entry, BFS following static imports, excluding main chunk modules
  for (const [targetModuleId, chunkId] of dynamicEntryPoints) {
    const chunkModuleIds = new Set();
    const queue = [targetModuleId];

    while (queue.length > 0) {
      const modId = queue.shift();
      if (chunkModuleIds.has(modId) || mainModuleIds.has(modId)) continue;
      chunkModuleIds.add(modId);

      const info = modules.get(modId);
      if (!info) continue;

      for (const imp of info.imports) {
        const depId = toModuleId(imp.resolvedPath, projectRoot);
        if (!chunkModuleIds.has(depId) && !mainModuleIds.has(depId)) {
          queue.push(depId);
        }
      }
    }

    lazyChunks.set(chunkId, {
      id: chunkId,
      moduleIds: chunkModuleIds,
      entryModuleId: targetModuleId,
    });
  }

  // --- Step 3: Split shared modules into separate chunks ---
  const { updatedLazyChunks, sharedChunks } = splitSharedModules(lazyChunks);

  // --- Step 4: Build ChunkGroup map ---
  // Each dynamic import's chunk ID maps to all chunk IDs needed (shared + own)
  const chunkGroupMap = {};

  for (const [chunkId, chunk] of updatedLazyChunks) {
    const neededChunks = [];

    // Find which shared chunks contain modules originally from this chunk's dependency tree
    for (const [sharedId, sharedChunk] of sharedChunks) {
      // Check if any module in the shared chunk was originally in this lazy chunk's tree
      if (sharedChunk.originalChunks.has(chunkId)) {
        neededChunks.push(sharedId);
      }
    }

    neededChunks.push(chunkId);
    chunkGroupMap[chunkId] = neededChunks;
  }

  // Store dynamic import → chunk ID mapping on each dynamic import node
  for (const [, info] of modules) {
    for (const dyn of info.dynamicImports) {
      if (dyn.resolvedPath) {
        const targetId = toModuleId(dyn.resolvedPath, projectRoot);
        dyn.targetModuleId = targetId;
        dyn.chunkId = toChunkId(targetId);
      }
    }
  }

  // Merge shared chunks into the full set of lazy chunks for output
  const allLazyChunks = new Map([...updatedLazyChunks, ...sharedChunks]);

  return {
    mainChunk: { id: 'main', moduleIds: mainModuleIds },
    lazyChunks: allLazyChunks,
    chunkGroupMap,
    modules,
    dynamicEntryPoints,
  };
}

/**
 * Find modules that appear in 2+ lazy chunks and extract them into shared chunks.
 */
function splitSharedModules(lazyChunks) {
  // Count how many lazy chunks each module appears in
  const moduleCounts = new Map();
  for (const [chunkId, chunk] of lazyChunks) {
    for (const modId of chunk.moduleIds) {
      if (!moduleCounts.has(modId)) {
        moduleCounts.set(modId, new Set());
      }
      moduleCounts.get(modId).add(chunkId);
    }
  }

  // Find modules shared by 2+ chunks
  const sharedModules = new Map(); // moduleId → Set of chunk IDs that use it
  for (const [modId, chunks] of moduleCounts) {
    if (chunks.size >= 2) {
      sharedModules.set(modId, chunks);
    }
  }

  if (sharedModules.size === 0) {
    return { updatedLazyChunks: lazyChunks, sharedChunks: new Map() };
  }

  // Group shared modules by the exact same set of chunks that use them
  // (modules shared by the same pair of chunks go into the same shared chunk)
  const groupKey = (chunkSet) => [...chunkSet].sort().join('|');
  const groups = new Map(); // key → { moduleIds: Set, chunkIds: Set }
  for (const [modId, chunkIds] of sharedModules) {
    const key = groupKey(chunkIds);
    if (!groups.has(key)) {
      groups.set(key, { moduleIds: new Set(), chunkIds: new Set(chunkIds) });
    }
    groups.get(key).moduleIds.add(modId);
  }

  // Create shared chunks
  const sharedChunks = new Map();
  for (const [, group] of groups) {
    // Name based on the first module in the group
    const firstModId = [...group.moduleIds][0];
    const sharedChunkId = 'shared_' + toChunkId(firstModId);

    sharedChunks.set(sharedChunkId, {
      id: sharedChunkId,
      moduleIds: group.moduleIds,
      entryModuleId: null, // shared chunks don't have an entry
      originalChunks: group.chunkIds, // which lazy chunks originally contained these
    });
  }

  // Remove shared modules from their original lazy chunks
  const updatedLazyChunks = new Map();
  for (const [chunkId, chunk] of lazyChunks) {
    const filteredModuleIds = new Set();
    for (const modId of chunk.moduleIds) {
      if (!sharedModules.has(modId)) {
        filteredModuleIds.add(modId);
      }
    }
    updatedLazyChunks.set(chunkId, {
      ...chunk,
      moduleIds: filteredModuleIds,
    });
  }

  return { updatedLazyChunks, sharedChunks };
}

module.exports = { buildDependencyGraph, identifyChunks, toModuleId, toChunkId };
