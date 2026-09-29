import './scene-asset-manifest.mjs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['--test', 'tests/assets.test.mjs'], { stdio: 'inherit' });
