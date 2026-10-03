import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'crypto'

const db = new PrismaClient()

function hashPassword(password: string, salt: string) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

async function main() {
  console.log('Seeding RideShift database...')

  // ---------- Admin user ----------
  const salt = 'rideshift-c1se48'
  await db.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: `${salt}$${hashPassword('admin123', salt)}`,
      fullName: 'System Administrator',
    },
  })

  // ---------- Transport modes ----------
  const modes = [
    { id: 'gasoline_motorbike', name: 'Gasoline Motorbike', icon: 'motorbike', description: 'Conventional gasoline-powered motorbike', avgSpeedKmh: 24, baseCostVnd: 0, costPerKmVnd: 320, co2PerKmG: 113, baseAccessibility: 0.92, baseConvenience: 0.85, waitMinutes: 0, sortOrder: 1 },
    { id: 'electric_motorbike', name: 'Electric Motorbike', icon: 'zap', description: 'Battery electric motorbike (VinFast, Yadea...)', avgSpeedKmh: 23, baseCostVnd: 0, costPerKmVnd: 120, co2PerKmG: 18, baseAccessibility: 0.88, baseConvenience: 0.8, waitMinutes: 0, sortOrder: 2 },
    { id: 'private_car', name: 'Private Car', icon: 'car', description: 'Privately owned car', avgSpeedKmh: 22, baseCostVnd: 5000, costPerKmVnd: 850, co2PerKmG: 168, baseAccessibility: 0.8, baseConvenience: 0.88, waitMinutes: 0, sortOrder: 3 },
    { id: 'bus', name: 'Public Bus', icon: 'bus', description: 'Hanoi public bus network', avgSpeedKmh: 17, baseCostVnd: 7000, costPerKmVnd: 0, co2PerKmG: 42, baseAccessibility: 0.55, baseConvenience: 0.5, waitMinutes: 10, sortOrder: 4 },
    { id: 'taxi', name: 'Taxi / Ride-hailing', icon: 'car-taxi-front', description: 'Taxi or ride-hailing service (Grab, Be...)', avgSpeedKmh: 26, baseCostVnd: 11000, costPerKmVnd: 12500, co2PerKmG: 150, baseAccessibility: 0.95, baseConvenience: 0.9, waitMinutes: 5, sortOrder: 5 },
    { id: 'bicycle', name: 'Bicycle', icon: 'bike', description: 'Conventional or shared bicycle', avgSpeedKmh: 12, baseCostVnd: 0, costPerKmVnd: 0, co2PerKmG: 0, baseAccessibility: 0.72, baseConvenience: 0.55, waitMinutes: 0, sortOrder: 6 },
    { id: 'walking', name: 'Walking', icon: 'footprints', description: 'Walking', avgSpeedKmh: 4.5, baseCostVnd: 0, costPerKmVnd: 0, co2PerKmG: 0, baseAccessibility: 0.6, baseConvenience: 0.4, waitMinutes: 0, sortOrder: 7 },
  ]
  for (const m of modes) {
    await db.transportMode.upsert({ where: { id: m.id }, update: m, create: m })
  }

  // ---------- LEZ zones (approx. Hanoi Ring Road 1 area) ----------
  const ring1 = [
    [21.0338, 105.8130], [21.0338, 105.8480], [21.0290, 105.8560], [21.0240, 105.8590],
    [21.0190, 105.8575], [21.0145, 105.8520], [21.0125, 105.8420], [21.0145, 105.8310],
    [21.0190, 105.8220], [21.0260, 105.8145],
  ]
  const oldQuarter = [
    [21.0360, 105.8470], [21.0362, 105.8552], [21.0310, 105.8556], [21.0305, 105.8475],
  ]

  const zone1 = await db.lezZone.upsert({
    where: { id: 'zone-ring-road-1' },
    update: { coordinates: JSON.stringify(ring1) },
    create: {
      id: 'zone-ring-road-1',
      name: 'Ring Road 1 LEZ',
      description: 'Low Emission Zone pilot for Ring Road 1 area per Hanoi LEZ Plan 2025-2026. Restricts high-emission vehicles during daytime hours.',
      coordinates: JSON.stringify(ring1),
      active: true,
    },
  })

  await db.lezZone.upsert({
    where: { id: 'zone-old-quarter' },
    update: { coordinates: JSON.stringify(oldQuarter) },
    create: {
      id: 'zone-old-quarter',
      name: 'Old Quarter Pilot Zone',
      description: 'Additional pilot Low Emission Zone covering the Old Quarter for demonstration purposes.',
      coordinates: JSON.stringify(oldQuarter),
      active: true,
    },
  })

  // ---------- Policy rules ----------
  const rules = [
    { zoneId: zone1.id, modeId: 'gasoline_motorbike', restrictionType: 'conditional', condition: 'Must meet Euro 3 standard or newer (registered from 2015). Motorbikes registered before 2015 are not permitted.', startTime: '06:00', endTime: '22:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat' },
    { zoneId: zone1.id, modeId: 'private_car', restrictionType: 'conditional', condition: 'Must meet Euro 4 emission standard or newer (registered from 2018).', startTime: '06:00', endTime: '22:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat' },
    { zoneId: zone1.id, modeId: 'bus', restrictionType: 'conditional', condition: 'Only CNG, electric or Euro 5+ buses are permitted inside the zone.', startTime: '00:00', endTime: '23:59', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' },
    { zoneId: zone1.id, modeId: 'bicycle', restrictionType: 'conditional', condition: 'Allowed all day; some streets restrict cycling during peak hours.', startTime: '00:00', endTime: '23:59', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' },
    { zoneId: zone1.id, modeId: 'walking', restrictionType: 'conditional', condition: 'Allowed all day; some pedestrian-only streets in the Old Quarter.', startTime: '00:00', endTime: '23:59', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' },
    { zoneId: zone1.id, modeId: 'electric_motorbike', restrictionType: 'conditional', condition: 'Fully permitted — zero tailpipe emission vehicles are exempt.', startTime: '00:00', endTime: '23:59', days: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' },
    { zoneId: zone1.id, modeId: 'taxi', restrictionType: 'conditional', condition: 'Only hybrid, electric or Euro 5 vehicles permitted.', startTime: '06:00', endTime: '22:00', days: 'Mon,Tue,Wed,Thu,Fri,Sat' },
  ]
  for (const r of rules) {
    const existing = await db.policyRule.findFirst({ where: { zoneId: r.zoneId, modeId: r.modeId } })
    if (existing) {
      await db.policyRule.update({ where: { id: existing.id }, data: r })
    } else {
      await db.policyRule.create({ data: r })
    }
  }

  // ---------- Criteria weights ----------
  const weights = [
    { criterion: 'travelTime', weight: 25, label: 'Travel Time' },
    { criterion: 'cost', weight: 20, label: 'Estimated Cost' },
    { criterion: 'lezCompliance', weight: 20, label: 'LEZ Compliance' },
    { criterion: 'accessibility', weight: 10, label: 'Accessibility' },
    { criterion: 'convenience', weight: 10, label: 'Convenience' },
    { criterion: 'environment', weight: 10, label: 'Environmental Impact' },
    { criterion: 'trend', weight: 5, label: 'Survey-based Trend' },
  ]
  for (const w of weights) {
    await db.criteriaWeight.upsert({ where: { criterion: w.criterion }, update: { weight: w.weight, label: w.label }, create: w })
  }

  // ---------- Transportation locations ----------
  const locations = [
    { name: 'Giap Bat Bus Station', type: 'bus_stop', lat: 21.0034, lng: 105.8412 },
    { name: 'My Dinh Bus Station', type: 'bus_stop', lat: 21.0276, lng: 105.7763 },
    { name: 'Nuoc Ngam Bus Station', type: 'bus_stop', lat: 20.9960, lng: 105.8495 },
    { name: 'Long Bien Bus Station', type: 'bus_stop', lat: 21.0338, lng: 105.8592 },
    { name: 'Kim Ma Bus Station', type: 'bus_stop', lat: 21.0342, lng: 105.8170 },
    { name: 'Gia Lam Bus Station', type: 'bus_stop', lat: 21.0378, lng: 105.8745 },
    { name: 'Yen Nghia Bus Station', type: 'bus_stop', lat: 20.9765, lng: 105.7895 },
    { name: 'Cat Linh Metro Station (Line 2A)', type: 'metro', lat: 21.0299, lng: 105.8147 },
    { name: 'Thuong Dinh Metro Station (Line 2A)', type: 'metro', lat: 20.9906, lng: 105.8085 },
    { name: 'La Khe Metro Station (Line 2A)', type: 'metro', lat: 20.9835, lng: 105.7806 },
    { name: 'BRT Trung Yen Stop', type: 'brt', lat: 21.0070, lng: 105.7872 },
    { name: 'BRT Nguyen Trai Stop', type: 'brt', lat: 20.9975, lng: 105.8148 },
  ]
  for (const l of locations) {
    const existing = await db.transportationLocation.findFirst({ where: { name: l.name } })
    if (!existing) await db.transportationLocation.create({ data: l })
  }

  // ---------- Demo trip records for analytics ----------
  const tripCount = await db.tripRecord.count()
  if (tripCount < 50) {
    const districts = ['Hoan Kiem', 'Ba Dinh', 'Dong Da', 'Hai Ba Trung', 'Cau Giay', 'Thanh Xuan', 'Tay Ho', 'Ha Dong']
    const places = ['Hoan Kiem Lake', 'My Dinh', 'Times City', 'Royal City', 'Big C Thang Long', 'Dong Xuan Market', 'Bach Mai Hospital', 'Keangnam Landmark', 'West Lake', 'Ba Dinh Square', 'Vincom Pham Ngoc Thach', 'Hanoi University of Science and Technology']
    const purposes = ['work', 'school', 'shopping', 'leisure', 'other']
    const modeIds = modes.map((m) => m.id)
    const records = []
    const now = Date.now()
    for (let i = 0; i < 140; i++) {
      const mode = modeIds[Math.floor(Math.random() * modeIds.length)]
      const top = modeIds[Math.floor(Math.random() * modeIds.length)]
      const switched = Math.random() < 0.3
      const createdAt = new Date(now - Math.floor(Math.random() * 30) * 86400000 - Math.floor(Math.random() * 10) * 3600000)
      records.push({
        originName: places[Math.floor(Math.random() * places.length)],
        destName: places[Math.floor(Math.random() * places.length)],
        originDistrict: districts[Math.floor(Math.random() * districts.length)],
        originLat: 20.98 + Math.random() * 0.06,
        originLng: 105.78 + Math.random() * 0.09,
        destLat: 20.98 + Math.random() * 0.06,
        destLng: 105.78 + Math.random() * 0.09,
        distanceKm: 2 + Math.random() * 14,
        durationMin: 10 + Math.random() * 45,
        vehicleId: mode,
        purpose: purposes[Math.floor(Math.random() * purposes.length)],
        departureHour: Math.floor(Math.random() * 24),
        lezAffected: Math.random() < 0.45,
        topModeId: top,
        topScore: 0.5 + Math.random() * 0.45,
        avgCostVnd: Math.floor(5000 + Math.random() * 90000),
        avgTimeMin: 10 + Math.random() * 45,
        chosenModeId: switched ? modeIds[Math.floor(Math.random() * modeIds.length)] : null,
        switched,
        createdAt,
      })
    }
    await db.tripRecord.createMany({ data: records })
  }

  console.log('Seed completed.')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await db.$disconnect()
    process.exit(1)
  })
