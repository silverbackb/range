const KM_PER_DEG_LAT = 111.0;

export function generateGrid(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  density: number,
): Array<{ lat: number; lng: number }> {
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  const step = (radiusKm * 2) / (density - 1);
  const points: Array<{ lat: number; lng: number }> = [];

  for (let row = 0; row < density; row++) {
    for (let col = 0; col < density; col++) {
      const oLat = -radiusKm + row * step;
      const oLng = -radiusKm + col * step;
      if (Math.sqrt(oLat ** 2 + oLng ** 2) <= radiusKm) {
        points.push({
          lat: Math.round((centerLat + oLat / KM_PER_DEG_LAT) * 10000) / 10000,
          lng: Math.round((centerLng + oLng / kmPerDegLng) * 10000) / 10000,
        });
      }
    }
  }

  return points;
}

export function parseDensity(density: string): number {
  return parseInt(density.split("x")[0], 10);
}
