// One-off: import the JSON backup (db/backup-sqlite.json) into PostgreSQL.
// Run AFTER `prisma db push` on the postgresql provider (fresh database).
// Usage: bun scripts/import-pg.ts
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

const db = new PrismaClient()

async function main() {
  const data = JSON.parse(readFileSync('db/backup-sqlite.json', 'utf8'))

  // Parents first (policyRule needs lezZone + transportMode)
  if (data.adminUser.length) await db.adminUser.createMany({ data: data.adminUser })
  if (data.transportMode.length) await db.transportMode.createMany({ data: data.transportMode })
  if (data.lezZone.length) await db.lezZone.createMany({ data: data.lezZone })
  if (data.policyRule.length) await db.policyRule.createMany({ data: data.policyRule })
  if (data.criteriaWeight.length) await db.criteriaWeight.createMany({ data: data.criteriaWeight })
  if (data.transportationLocation.length)
    await db.transportationLocation.createMany({ data: data.transportationLocation })
  if (data.tripRecord.length) await db.tripRecord.createMany({ data: data.tripRecord })

  const counts = {
    adminUser: await db.adminUser.count(),
    transportMode: await db.transportMode.count(),
    lezZone: await db.lezZone.count(),
    policyRule: await db.policyRule.count(),
    criteriaWeight: await db.criteriaWeight.count(),
    transportationLocation: await db.transportationLocation.count(),
    tripRecord: await db.tripRecord.count(),
  }
  console.log('Imported into PostgreSQL:', JSON.stringify(counts))
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
