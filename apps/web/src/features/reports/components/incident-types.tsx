import type { IncidentType } from '@urbansafe/shared';
import type { ReactNode } from 'react';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="type-icon" {...stroke}>
      {children}
    </svg>
  );
}

const ICONS: Record<IncidentType, ReactNode> = {
  personal_theft: (
    <Glyph>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    </Glyph>
  ),
  motorcycle_theft: (
    <Glyph>
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="17.5" cy="16.5" r="2.5" />
      <path d="M9 16.5h6.2M6.5 16.5 10 11h5.2l2.3 5.5M12.2 11 13.5 7.5H17" />
    </Glyph>
  ),
  bicycle_theft: (
    <Glyph>
      <circle cx="6.5" cy="16" r="3" />
      <circle cx="17.5" cy="16" r="3" />
      <path d="M6.5 16 12 7.5h4.2M12 7.5 17.5 16M12 12.2h4.5" />
    </Glyph>
  ),
  vehicle_theft: (
    <Glyph>
      <path d="M4 15.5v-1.8L6.2 9h11.6L20 13.7v1.8" />
      <path d="M4 13.8h16" />
      <circle cx="7.5" cy="16.2" r="1.4" />
      <circle cx="16.5" cy="16.2" r="1.4" />
    </Glyph>
  ),
  armed_robbery: (
    <Glyph>
      <path d="M4 9.5h9.5V13H8.8L7.6 17H5.8l1.2-4H4z" />
      <path d="M13.5 9.5H18v2.2h-4.5" />
    </Glyph>
  ),
  homicide: (
    <Glyph>
      <path d="M12 4.5v15M7.5 8.5h9" />
    </Glyph>
  ),
  assault: (
    <Glyph>
      <path d="M13 3.5 5.5 13H11l-1 7.5 8.5-11.2H13l.8-5.8z" />
    </Glyph>
  ),
  fight: (
    <Glyph>
      <circle cx="8" cy="7.5" r="2" />
      <circle cx="16" cy="7.5" r="2" />
      <path d="M5 18.5c.4-2.6 1.8-4 3.6-4M15.4 14.5c1.8 0 3.2 1.4 3.6 4M9.2 12.5h5.6" />
    </Glyph>
  ),
  other: (
    <Glyph>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  ),
};

export const INCIDENT_HINTS: Record<IncidentType, string> = {
  personal_theft: 'Algo que llevaba encima, sin arma.',
  motorcycle_theft: 'Se llevaron una moto.',
  bicycle_theft: 'Se llevaron una bicicleta.',
  vehicle_theft: 'Se llevaron un carro.',
  armed_robbery: 'Lo amenazaron con un arma.',
  homicide: 'Alguien murió de forma violenta.',
  assault: 'Golpes o heridas, sin que haya muerto.',
  fight: 'Una pelea entre varias personas.',
  other: 'No encaja en los demás.',
};

export function IncidentTypeIcon({ type }: { type: IncidentType }) {
  return ICONS[type];
}
