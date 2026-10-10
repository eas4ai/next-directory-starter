import "./load-env.mjs";
import { seedCatalog } from "../src/lib/catalog-migrations";

seedCatalog();
process.stdout.write("Sample catalog seeded.\n");
