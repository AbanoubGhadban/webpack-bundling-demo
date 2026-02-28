#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { buildDependencyGraph, identifyChunks } = require('./src/dependency-graph');
const { generateBundles } = require('./src/code-generator');

// --- Parse CLI arguments ---
const args = process.argv.slice(2);
let entryArg = null;
let outputArg = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--entry' && args[i + 1]) {
    entryArg = args[++i];
  } else if (args[i] === '--output' && args[i + 1]) {
    outputArg = args[++i];
  }
}

if (!entryArg || !outputArg) {
  console.error('Usage: node bundler.js --entry <path> --output <dir>');
  console.error('Example: node bundler.js --entry ./example/src/index.js --output ./example/dist');
  process.exit(1);
}

const projectRoot = process.cwd();
const entryPath = path.resolve(projectRoot, entryArg);
const outputDir = path.resolve(projectRoot, outputArg);

if (!fs.existsSync(entryPath)) {
  console.error(`Entry file not found: ${entryPath}`);
  process.exit(1);
}

// --- Run the bundler pipeline ---
console.log(`\nBundling from: ${path.relative(projectRoot, entryPath)}`);
console.log(`Output dir:   ${path.relative(projectRoot, outputDir)}\n`);

// Step 1: Build dependency graph
console.log('1. Building dependency graph...');
const graph = buildDependencyGraph(entryPath);
console.log(`   Found ${graph.size} modules`);

// Step 2: Identify chunks
console.log('2. Identifying chunks...');
const chunkInfo = identifyChunks(graph, entryPath, projectRoot);
console.log(`   Main chunk: ${chunkInfo.mainChunk.moduleIds.size} modules`);
console.log(`   Lazy chunks: ${chunkInfo.lazyChunks.size}`);
for (const [chunkId, chunk] of chunkInfo.lazyChunks) {
  console.log(`     - ${chunkId} (${chunk.moduleIds.size} modules)`);
}
if (Object.keys(chunkInfo.chunkGroupMap).length > 0) {
  console.log('   ChunkGroups:');
  for (const [chunkId, needed] of Object.entries(chunkInfo.chunkGroupMap)) {
    console.log(`     - ${chunkId} needs: [${needed.join(', ')}]`);
  }
}

// Step 3: Generate bundle output
console.log('3. Generating bundles...');
const bundles = generateBundles(chunkInfo, projectRoot);

// Step 4: Write output files
console.log('4. Writing output files...');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

for (const bundle of bundles) {
  const outputPath = path.join(outputDir, bundle.filename);
  fs.writeFileSync(outputPath, bundle.content, 'utf-8');
  console.log(`   ${bundle.filename} (${bundle.content.length} bytes)`);
}

console.log('\nDone!\n');
