import "./load-env.mjs";
import { migrateCatalog } from "../src/lib/catalog-migrations";

migrateCatalog(true);
process.stdout.write("Catalog migration complete.\n");
