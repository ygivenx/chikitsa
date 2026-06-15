import { createApp, lakebase, server, serving } from '@databricks/appkit';
import { setupChikitsaRoutes } from './routes/chikitsa-routes';

createApp({
  plugins: [
    lakebase(),
    server(),
    serving(),
  ],
  async onPluginsReady(appkit) {
    await setupChikitsaRoutes(appkit);
  },
}).catch(console.error);
