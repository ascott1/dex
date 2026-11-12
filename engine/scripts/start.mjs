// `pnpm start [slug]`: start the Vite dev server and open the browser.
// Runs Vite through its API instead of the CLI, because `vite <arg>` would
// treat the slug as the project root.
import { createServer } from 'vite';

const slug = process.argv[2];

const server = await createServer({
  server: {
    open: slug ? `/#/${slug}` : true,
  },
});

await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
