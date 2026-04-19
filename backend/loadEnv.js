/**
 * Must be imported before any module that reads process.env at load time
 * (e.g. src/authSupabase.js). Static imports in server.js are hoisted, so
 * dotenv cannot run "between" imports in the same file.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, ".env") })
