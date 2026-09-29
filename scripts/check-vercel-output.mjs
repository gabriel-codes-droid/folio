import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.vercel', 'output');
const publicDirectory = join(root, 'public');
const staticDirectory = join(output, 'static');
const functionsDirectory = join(output, 'functions');
const functionLimit = 250 * 1024 * 1024;
const sceneExtensions = new Set(['.glb', '.gltf', '.fbx', '.exr', '.hdr']);
let skippedDirectoryLinks = 0;

function requirePath(path, type) {
  if (!existsSync(path) || !(type === 'file' ? statSync(path).isFile() : statSync(path).isDirectory())) {
    throw new Error(`Missing ${type}: ${relative(root, path)}. Run the Vercel build first.`);
  }
}

// Resolve file links for their real sizes, but never descend into directory links.
// This prevents loops while still auditing symlinked regular files normally.
function entries(directory) {
  return readdirSync(directory).map(name => {
    const path = join(directory, name);
    let stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      stats = statSync(path);
      if (stats.isDirectory()) {
        skippedDirectoryLinks++;
        return null;
      }
    }
    return { path, stats };
  }).filter(Boolean);
}

function* files(directory) {
  for (const entry of entries(directory)) {
    if (entry.stats.isDirectory()) yield* files(entry.path);
    else if (entry.stats.isFile()) yield entry;
  }
}

function* functionDirectories(directory) {
  for (const entry of entries(directory)) {
    if (!entry.stats.isDirectory()) continue;
    if (entry.path.endsWith('.func')) yield entry.path;
    else yield* functionDirectories(entry.path);
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  requirePath(join(output, 'config.json'), 'file');
  requirePath(join(staticDirectory, 'index.html'), 'file');
  requirePath(publicDirectory, 'directory');
  requirePath(functionsDirectory, 'directory');

  let functionCount = 0;
  let functionFileCount = 0;
  let functionTotalBytes = 0;
  let functionMaxBytes = 0;
  let oversizedFunctions = 0;
  let sceneFiles = 0;
  let privateEnvFiles = 0;
  for (const directory of functionDirectories(functionsDirectory)) {
    functionCount++;
    let bytes = 0;
    for (const { path, stats } of files(directory)) {
      functionFileCount++;
      bytes += stats.size;
      if (sceneExtensions.has(extname(path).toLowerCase())) sceneFiles++;
      const name = basename(path).toLowerCase();
      if (name === '.env' || name.startsWith('.env.')) privateEnvFiles++;
    }
    functionTotalBytes += bytes;
    functionMaxBytes = Math.max(functionMaxBytes, bytes);
    if (bytes > functionLimit) oversizedFunctions++;
  }
  if (!functionCount) throw new Error('No .func directories found in .vercel/output/functions. The contact endpoint needs server output.');
  console.log(`Functions: count=${functionCount}, files=${functionFileCount}, totalBytes=${functionTotalBytes}, maxBytes=${functionMaxBytes}`);
  if (sceneFiles || privateEnvFiles || oversizedFunctions) {
    throw new Error(`Function audit failed: sceneFiles=${sceneFiles}, privateEnvFiles=${privateEnvFiles}, oversizedFunctions=${oversizedFunctions}, maxAllowedBytes=${functionLimit}`);
  }

  let publicFileCount = 0;
  let publicTotalBytes = 0;
  let publicMaxBytes = 0;
  let missingStaticFiles = 0;
  let sizeMismatches = 0;
  let hashMismatches = 0;
  for (const { path, stats } of files(publicDirectory)) {
    publicFileCount++;
    publicTotalBytes += stats.size;
    publicMaxBytes = Math.max(publicMaxBytes, stats.size);
    const staticPath = join(staticDirectory, relative(publicDirectory, path));
    if (!existsSync(staticPath) || !statSync(staticPath).isFile()) {
      missingStaticFiles++;
      continue;
    }
    if (stats.size !== statSync(staticPath).size) {
      sizeMismatches++;
      continue;
    }
    const [sourceHash, staticHash] = await Promise.all([sha256(path), sha256(staticPath)]);
    if (sourceHash !== staticHash) hashMismatches++;
  }
  console.log(`Public assets: count=${publicFileCount}, totalBytes=${publicTotalBytes}, maxBytes=${publicMaxBytes}`);
  if (missingStaticFiles || sizeMismatches || hashMismatches) {
    throw new Error(`Static asset audit failed: missingFiles=${missingStaticFiles}, sizeMismatches=${sizeMismatches}, sha256Mismatches=${hashMismatches}`);
  }
  console.log(`Vercel output verified: matchedAssets=${publicFileCount}, skippedDirectoryLinks=${skippedDirectoryLinks}`);
} catch (error) {
  console.error(`Vercel output check failed: ${error instanceof Error ? error.message : 'Unknown filesystem error.'}`);
  process.exitCode = 1;
}
