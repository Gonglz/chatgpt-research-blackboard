import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');
const isDev = isWatch && !isRelease;

const stripDebugLogsPlugin = {
  name: 'strip-debug-logs',
  setup(build) {
    if (!isRelease) return;

    build.onLoad({ filter: /\.jsx?$/ }, async (args) => {
      const fs = await import('fs');
      let contents = await fs.promises.readFile(args.path, 'utf8');
      contents = contents.replace(/console\.(log|debug|info)\s*\([^;]*\);?/g, '');
      return {
        contents,
        loader: args.path.endsWith('.jsx') ? 'jsx' : 'js'
      };
    });
  }
};

const commonOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome115'],
  sourcemap: isDev ? 'inline' : false,
  minify: isRelease,
  plugins: [stripDebugLogsPlugin],
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  logLevel: 'info'
};

const reactOptions = {
  ...commonOptions,
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx'
  },
  jsx: 'automatic'
};

const builds = [
  {
    ...commonOptions,
    entryPoints: ['src/content/research-runtime.js'],
    outfile: 'dist/content.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/research-producer.js'],
    outfile: 'dist/research-producer.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/research-selection-v2.js'],
    outfile: 'dist/research-selection.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/background/index.js'],
    outfile: 'dist/background.js'
  },
  {
    ...reactOptions,
    entryPoints: ['src/sidepanel/index.jsx'],
    outfile: 'dist/sidepanel.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/sidepanel/styles/index.css'],
    outfile: 'dist/sidepanel.css'
  }
];

async function build() {
  try {
    if (isWatch) {
      console.log('Watching for changes...');
      const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
      await Promise.all(contexts.map((context) => context.watch()));
    } else {
      await Promise.all(builds.map((options) => esbuild.build(options)));
      console.log(isRelease
        ? '√ Release build completed! (debug logs removed, minified)'
        : '√ Build completed!');
    }
  } catch (error) {
    console.error('× Build failed:', error);
    process.exit(1);
  }
}

build();
