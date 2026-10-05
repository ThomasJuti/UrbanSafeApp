import { PARAMS } from '@urbansafe/shared';
import type { SubmitResult } from './api';

export type ResultMessage = { tone: 'success' | 'warning' | 'error'; text: string };

export function resultMessage(result: SubmitResult): ResultMessage {
  if (result.kind === 'rate_limited') {
    return {
      tone: 'warning',
      text: `Llegaste al límite de ${PARAMS.reportRateLimit.max} reportes por hora. Intenta más tarde.`,
    };
  }
  if (result.kind === 'failed') {
    return { tone: 'error', text: 'No se pudo enviar el reporte. Revisa tu conexión e inténtalo otra vez.' };
  }
  switch (result.outcome) {
    case 'created':
      return { tone: 'success', text: 'Reporte enviado. Ya lo ven los demás.' };
    case 'confirmed':
      return { tone: 'success', text: 'Alguien ya lo había reportado: sumaste tu confirmación.' };
    case 'already_counted':
      return { tone: 'warning', text: 'Ya habías reportado esto.' };
  }
}
