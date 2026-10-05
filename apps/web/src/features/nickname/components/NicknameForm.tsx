import { nicknameSchema } from '@urbansafe/shared';
import { useState, type FormEvent } from 'react';

export function NicknameForm({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState('');
  const valid = nicknameSchema.safeParse(value).success;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit(value);
  };

  return (
    <div className="overlay">
      <form className="card nickname-form" onSubmit={handleSubmit}>
        <h1>UrbanSafe</h1>
        <p>Reporta lo que veas en la calle para que otros domiciliarios lo eviten. No necesitas cuenta.</p>
        <label htmlFor="nickname">¿Cómo te llamamos?</label>
        <input
          id="nickname"
          autoFocus
          autoComplete="nickname"
          maxLength={30}
          placeholder="Tu apodo"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="button primary" disabled={!valid}>
          Entrar
        </button>
      </form>
    </div>
  );
}
