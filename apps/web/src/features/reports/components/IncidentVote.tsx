import type { Vote } from '@urbansafe/shared';
import { useState } from 'react';
import { castVote } from '../api';
import type { ResultMessage } from '../result-message';
import { voteMessage } from '../vote-message';

type Reporter = { deviceId: string; nickname: string };

export function IncidentVote({ incidentId, reporter }: { incidentId: string; reporter: Reporter }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<ResultMessage | null>(null);

  const send = async (vote: Vote) => {
    setSending(true);
    const result = await castVote({ incidentId, vote, ...reporter });
    setSending(false);
    setMessage(voteMessage(vote, result));
  };

  if (message && message.tone !== 'error') {
    return <p className={`vote-result ${message.tone}`}>{message.text}</p>;
  }

  return (
    <div className="vote">
      <p>¿Sigue ahí?</p>
      <div className="vote-actions">
        <button type="button" className="button primary" disabled={sending} onClick={() => send('confirm')}>
          Sí
        </button>
        <button type="button" className="button" disabled={sending} onClick={() => send('deny')}>
          No
        </button>
      </div>
      {message && <p className="vote-result error">{message.text}</p>}
    </div>
  );
}
