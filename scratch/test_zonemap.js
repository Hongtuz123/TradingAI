const fs = require('fs');

const isPointInPolygon = (point, vs) => {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

async function test() {
  const geojsonPath = 'C:\\GoogleAntigravity\\2026IoTcenter\\dashboard\\public\\industrial-zones.geojson';
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
  
  const res = await fetch('https://tc-iot-center.vercel.app/api/sensors');
  const sensorsData = await res.json();
  
  const zones = [];
  const zoneMap = {};
  
  if (geojson && geojson.features) {
    geojson.features.forEach((feature) => {
      const zoneName = feature.properties.name;
      if (zoneName && !zones.includes(zoneName)) {
        zones.push(zoneName);
      }
      const geom = feature.geometry;
      
      sensorsData.forEach((sensor) => {
        const pt = [sensor.lon, sensor.lat];
        let inZone = false;
        if (geom.type === 'Polygon') {
          inZone = geom.coordinates.some((ring) => isPointInPolygon(pt, ring));
        } else if (geom.type === 'MultiPolygon') {
          inZone = geom.coordinates.some((poly) => 
            poly.some((ring) => isPointInPolygon(pt, ring))
          );
        }
        if (inZone) {
          zoneMap[sensor.id] = zoneName;
        }
      });
    });
  }
  
  console.log(`zoneMap size: ${Object.keys(zoneMap).length}`);
  
  // 統計每個園區分到了多少個點
  const stats = {};
  Object.values(zoneMap).forEach(name => {
    stats[name] = (stats[name] || 0) + 1;
  });
  console.log('Stats:', JSON.stringify(stats, null, 2));
}

test().catch(console.error);
