import { execSync } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  copyFileSync,
  statSync,
  readdirSync
} from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

const FILES_TO_INCLUDE = [
  'manifest.json',
  'dist',
  'src/sidepanel/index.html',
  'assets',
  '_locales',
  'NOTICE.md',
  'LICENSE_STATUS.md',
  'PRIVACY.md'
];

const EXCLUDE_FILES = ['icon1024.png'];
const RELEASE_DIR = join(ROOT, 'release');
const ZIP_NAME = `chatgpt-research-blackboard-v${VERSION}.zip`;

async function main() {
  console.log(`\n📦 Building ChatGPT Research Blackboard v${VERSION}...\n`);
  console.warn('⚠ Review LICENSE_STATUS.md before redistributing this package.');

  execSync('npm run test', { cwd: ROOT, stdio: 'inherit' });
  execSync('npm run build:release', { cwd: ROOT, stdio: 'inherit' });

  if (existsSync(RELEASE_DIR)) rmSync(RELEASE_DIR, { recursive: true });
  mkdirSync(RELEASE_DIR, { recursive: true });

  for (const file of FILES_TO_INCLUDE) {
    const src = join(ROOT, file);
    const dest = join(RELEASE_DIR, file);
    if (!existsSync(src)) {
      console.warn(`⚠ Skipping missing release input: ${file}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyRecursive(src, dest);
  }

  const zipPath = join(ROOT, ZIP_NAME);
  await createZip(RELEASE_DIR, zipPath);

  console.log(`\n✓ Release package built: ${ZIP_NAME}`);
  console.log('  This script creates a package only; it does not imply that licensing or store-release review is complete.\n');
}

function copyRecursive(src, dest) {
  const stat = statSync(src);
  if (stat.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const child of readdirSync(src)) {
      if (EXCLUDE_FILES.includes(child)) continue;
      copyRecursive(join(src, child), join(dest, child));
    }
  } else {
    copyFileSync(src, dest);
  }
}

function createZip(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const size = (archive.pointer() / 1024).toFixed(1);
      console.log(`✓ ${basename(outPath)} (${size} KB)`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
