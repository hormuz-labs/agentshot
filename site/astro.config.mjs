// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  devToolbar: { enabled: false },
  // the CSS is small: inline it so the first paint doesn't wait on a stylesheet request
  build: { inlineStylesheets: 'always' },
});
