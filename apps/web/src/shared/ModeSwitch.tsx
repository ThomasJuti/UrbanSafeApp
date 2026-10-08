import { NavLink } from 'react-router';

const MODES = [
  { to: '/reportar', label: 'Reportar' },
  { to: '/domiciliario', label: 'Rodar' },
] as const;

export function ModeSwitch() {
  return (
    <nav className="mode-switch" aria-label="Modo">
      {MODES.map((mode) => (
        <NavLink key={mode.to} to={mode.to}>
          {mode.label}
        </NavLink>
      ))}
    </nav>
  );
}
