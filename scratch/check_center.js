const fs = require('fs');

function check() {
  const geojsonPath = 'C:\\GoogleAntigravity\\2026IoTcenter\\dashboard\\public\\industrial-zones.geojson';
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
  
  const feature = geojson.features.find(f => f.properties.name === '台中港關連產業園區');
  const geom = feature.geometry;
  
  let sumLon = 0, sumLat = 0, count = 0;
  const processCoords = (ring) => {
    ring.forEach(([lon, lat]) => {
      sumLon += lon;
      sumLat += lat;
      count++;
    });
  };
  
  if (geom.type === 'Polygon') {
    geom.coordinates.forEach(processCoords);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach((poly) => poly.forEach(processCoords));
  }
  
  console.log(`Count: ${count}`);
  console.log(`Avg Lon: ${sumLon / count}`);
  console.log(`Avg Lat: ${sumLat / count}`);
}

check();
