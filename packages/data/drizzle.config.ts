import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/schema/index.ts',
    out: './migrations',
    dialect: 'sqlite',
    dbCredentials: {
        url: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/local-db.sqlite',
    },
});
