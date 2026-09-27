// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel(),
  session: false,
  integrations: [react()],
  // Models use /models/ URLs from public. assetsInclude would also bundle
  // every matching model into the Vercel function, duplicating static assets.
});
