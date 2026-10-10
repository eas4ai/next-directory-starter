import "./load-env.mjs";
import { migrateCatalog } from "../src/lib/catalog-migrations";

migrateCatalog();
process.stdout.write("Catalog migration complete.\n");
