import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { METRIC_DEFINITIONS } from "./metrics.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const scenarioPath =
    process.argv[2] ??
    path.join(__dirname, "..", "scenarios", "frozen_v0.json")

  const raw = await readFile(scenarioPath, "utf8")
  const scenario = JSON.parse(raw)

  console.log("=== ORBIT — Phase 0 (frozen input + metric contract) ===\n")
  console.log(`Loaded scenario: ${scenarioPath}\n`)

  console.log("--- Metric definitions (Y will map to these) ---")
  for (const m of METRIC_DEFINITIONS) {
    console.log(`\n${m.displayName} [${m.key}]`)
    console.log(`  Unit: ${m.unit}`)
    console.log(`  Range: ${m.range}`)
    console.log(`  Meaning: ${m.description}`)
  }

  console.log("\n--- Parsed scenario (canonical JSON) ---\n")
  console.log(JSON.stringify(scenario, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
