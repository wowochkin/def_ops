import normals from './climate/monthly-air.json' with {type:'json'};

const longitudeCount = 360 / normals.longitudeStep;

// Средние температуры NOAA хранятся в десятых долях °C, широты гауссовой сетки убывают.
export function climateAt(lat: number, lon: number, time: number) {
  const x = ((lon % 360 + 360) % 360) / normals.longitudeStep;
  const west = Math.floor(x), east = (west + 1) % longitudeCount;
  const last = normals.lat.length - 1;
  let north = 0;
  while (north < last - 1 && normals.lat[north + 1] > lat) north++;
  const south = north + 1;
  const y = Math.max(0, Math.min(1, (normals.lat[north] - lat) / (normals.lat[north] - normals.lat[south])));
  function sample(grid: number[]) {
    const row = (i: number) => grid[i * longitudeCount + west] * (1 - (x - west)) + grid[i * longitudeCount + east] * (x - west);
    return row(north) * (1 - y) + row(south) * y;
  }
  const date = new Date(time);
  const month = date.getUTCMonth();
  const middle = new Date(time);
  middle.setUTCDate(15);
  middle.setUTCHours(0, 0, 0, 0);
  const step = time < middle.getTime() ? -1 : 1;
  const neighbor = new Date(middle);
  neighbor.setUTCMonth(month + step);
  const fraction = (time - middle.getTime()) / (neighbor.getTime() - middle.getTime());
  const first = sample(normals.months[month]);
  const second = sample(normals.months[(month + step + 12) % 12]);
  return {temperature: (first * (1 - fraction) + second * fraction) / 10, heightM: sample(normals.heights)};
}
