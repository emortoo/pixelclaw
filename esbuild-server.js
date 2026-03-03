const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');

/**
 * Copy assets folder to dist/assets
 */
function copyAssets() {
	const srcDir = path.join(__dirname, 'webview-ui', 'public', 'assets');
	const dstDir = path.join(__dirname, 'dist', 'assets');

	if (fs.existsSync(srcDir)) {
		if (fs.existsSync(dstDir)) {
			fs.rmSync(dstDir, { recursive: true });
		}
		fs.cpSync(srcDir, dstDir, { recursive: true });
		console.log('✓ Copied assets/ → dist/assets/');
	} else {
		console.log('ℹ️  assets/ folder not found (optional)');
	}
}

async function main() {
	await esbuild.build({
		entryPoints: ['server/index.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/server.js',
		external: ['express', 'ws', 'pngjs'],
		logLevel: 'info',
	});

	// Copy assets after build
	copyAssets();

	console.log('✓ Server built → dist/server.js');
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
