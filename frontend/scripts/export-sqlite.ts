// One-off: export all business data from the legacy SQLite DB to JSON
// Run BEFORE switching prisma provider to postgresql (uses the sqlite engine).
// Usage: bun scripts/export-sqlite.ts
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'

const db = new PrismaClient()

async function main() {
  const data = {
    exportedAt: new Date().toISOString(),
    adminUser: await db.adminUser.findMany(),
    transportMode: await db.transportMode.findMany(),
    lezZone: await db.lezZone.findMany(),
    policyRule: await db.policyRule.findMany(),
    criteriaWeight: await db.criteriaWeight.findMany(),
    transportationLocation: await db.transportationLocation.findMany(),
    tripRecord: await db.tripRecord.findMany(),
  }
  writeFileSync('db/backup-sqlite.json', JSON.stringify(data, null, 2))
  console.log(
    'Exported to db/backup-sqlite.json:',
    Object.entries(data)
      .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
      .join(', ')
  )
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
