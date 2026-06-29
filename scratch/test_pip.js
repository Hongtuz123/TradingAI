const fs = require('fs');
const path = require('path');

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
  
  // 取得生產環境的 sensors 資料
  const res = await fetch('https://tc-iot-center.vercel.app/api/sensors');
  const sensors = await res.json();
  
  console.log(`Loaded ${sensors.length} sensors.`);
  
  const targetFeature = geojson.features.find(f => f.properties.name === '台中港關連產業園區');
  if (!targetFeature) {
    console.error('Feature not found');
    return;
  }
  
  const geom = targetFeature.geometry;
  console.log(`Geom type: ${geom.type}`);
  
  const results = [];
  
  sensors.forEach((sensor) => {
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
      results.push(sensor);
    }
  });
  
  console.log(`Found ${results.length} sensors inside "台中港關連產業園區":`);
  results.forEach(s => {
    console.log(`ID: ${s.id}, Name: ${s.name}, Lon: ${s.lon}, Lat: ${s.lat}, County: ${s.county}`);
  });
}

test().catch(console.error);
