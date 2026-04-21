import { loadConfig } from "./server.js";
import { createPostgresSessionStore } from "./stores/postgres.js";

async function main() {
  const config = loadConfig();

  if (config.sessionStoreDriver !== "postgres") {
    throw new Error(`Migration runner requires SESSION_STORE_DRIVER=postgres, received "${config.sessionStoreDriver}".`);
  }

  const store = createPostgresSessionStore({
    connectionString: config.sessionStoreUrl
  });

  try {
    await store.init();
  } finally {
    await store.close();
  }
}

void main();
