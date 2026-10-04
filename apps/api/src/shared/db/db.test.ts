import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from './index';

describe('poolConfigFromUrl', () => {
  it('quita sslmode de la URL y activa SSL sin verificación', () => {
    const config = poolConfigFromUrl('postgresql://u:p@host:5432/postgres?sslmode=require');
    expect(config.connectionString).toBe('postgresql://u:p@host:5432/postgres');
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('sin sslmode no activa SSL', () => {
    const config = poolConfigFromUrl('postgresql://u:p@localhost:5432/postgres');
    expect(config.ssl).toBeUndefined();
  });

  it('respeta sslmode=disable', () => {
    expect(poolConfigFromUrl('postgresql://u:p@localhost/db?sslmode=disable').ssl).toBeUndefined();
  });
});
