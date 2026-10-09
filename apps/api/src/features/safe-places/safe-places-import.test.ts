import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, parseSafePlaces } from './safe-places-import';

describe('parseSafePlaces (M8)', () => {
  it('toma el punto de los nodos y el centro de las vías', () => {
    const places = parseSafePlaces({
      elements: [
        { type: 'node', id: 1, lat: 4.65, lon: -74.06, tags: { amenity: 'police', name: 'CAI Chapinero' } },
        { type: 'way', id: 2, center: { lat: 4.7, lon: -74.1 }, tags: { amenity: 'fuel', opening_hours: '24/7', brand: 'Terpel' } },
      ],
    });

    expect(places).toEqual([
      { osmType: 'node', osmId: 1, kind: 'police', name: 'CAI Chapinero', lat: 4.65, lng: -74.06 },
      { osmType: 'way', osmId: 2, kind: 'fuel', name: 'Terpel', lat: 4.7, lng: -74.1 },
    ]);
  });

  it('deja el nombre en null cuando OSM no lo trae y descarta otros amenity', () => {
    const places = parseSafePlaces({
      elements: [
        { type: 'node', id: 3, lat: 4.6, lon: -74.1, tags: { amenity: 'police' } },
        { type: 'node', id: 4, lat: 4.6, lon: -74.1, tags: { amenity: 'cafe' } },
      ],
    });

    expect(places).toHaveLength(1);
    expect(places[0]?.name).toBeNull();
  });

  it('rechaza una respuesta que no es de Overpass', () => {
    expect(() => parseSafePlaces({ elements: [{ type: 'node', id: 'x' }] })).toThrow();
  });
});

describe('buildOverpassQuery', () => {
  it('pide policía y gasolineras 24 h dentro del casco urbano', () => {
    const query = buildOverpassQuery();

    expect(query).toContain('"amenity"="police"');
    expect(query).toContain('"opening_hours"="24/7"');
    expect(query).toContain('4.46,-74.23,4.84,-73.99');
  });
});
