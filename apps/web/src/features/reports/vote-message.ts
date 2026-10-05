import type { Vote } from '@urbansafe/shared';
import type { VoteResult } from './api';
import type { ResultMessage } from './result-message';

export function voteMessage(vote: Vote, result: VoteResult): ResultMessage {
  if (result.kind === 'failed') return { tone: 'error', text: 'No se pudo enviar tu voto. Inténtalo otra vez.' };
  if (result.kind === 'not_available') return { tone: 'warning', text: 'Este incidente ya no está en el mapa.' };
  switch (result.outcome) {
    case 'counted':
      return {
        tone: 'success',
        text: vote === 'confirm' ? 'Gracias, confirmaste que sigue ahí.' : 'Gracias, avisaste que ya no está.',
      };
    case 'already_voted':
      return { tone: 'warning', text: 'Ya habías votado este incidente.' };
    case 'own_report':
      return { tone: 'warning', text: 'Este lo reportaste tú: lo tienen que confirmar otros.' };
  }
}
