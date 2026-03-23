/**
 * Build static JSON export and push to GitHub → triggers Vercel auto-deploy.
 * Called automatically after each crawl run.
 *
 * Usage: node workers/deploy-static.js
 */
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

async function main() {
  console.log('\n=== DEPLOY STATIC ===\n');

  // 1. Build static JSON from current DB
  const { default: _ } = await import('./build-static.js');

  // 2. Git commit + push (only if there are changes)
  try {
    run('git add public/api/*.json public/index.html');

    // Check if there are actual changes
    try {
      execSync('git diff --cached --quiet', { cwd: ROOT });
      console.log('\nNo data changes to deploy.');
      return;
    } catch {
      // There are changes — commit and push
    }

    const date = new Date().toISOString().split('T')[0];
    run(`git commit -m "Auto-update: crawl ${date}"`);
    run('git push');
    console.log('\nDeployed! Vercel will auto-rebuild in ~1 minute.');
  } catch (err) {
    console.error('Deploy failed:', err.message);
    console.log('You can manually run: git add public/ && git commit -m "update" && git push');
  }
}

main();
