import { useCallback, useState } from 'react';
import { loadIdentity, saveNickname, type Identity } from './identity-storage';

export function useIdentity() {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity());
  const chooseNickname = useCallback((nickname: string) => setIdentity(saveNickname(nickname)), []);
  return { identity, chooseNickname };
}
