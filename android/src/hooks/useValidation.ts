import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@/services/apiClient';
import { useConnection } from '@/state/ConnectionContext';
import type { Board, PuzzleValidation } from '@/types/api';

export type ValidationStatus = 'idle' | 'checking' | 'ok' | 'unavailable' | 'error';

export interface ValidationState {
  status: ValidationStatus;
  result: PuzzleValidation | null;
  message: string | null;
}

/**
 * Server-authoritative validation. The board is sent to the backend (debounced) after every change; the
 * duplicates it reports are what the UI highlights. When the backend is unreachable the board stays editable
 * and the UI says plainly that validation is unavailable, it never guesses.
 */
export function useValidation(board: Board, blank: boolean, debounceMs = 250): ValidationState & { validateNow: () => Promise<PuzzleValidation | null> } {
  const { api, backend } = useConnection();
  const [state, setState] = useState<ValidationState>({ status: 'idle', result: null, message: null });
  const seq = useRef(0);
  const key = JSON.stringify(board);

  const run = useCallback(async (): Promise<PuzzleValidation | null> => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, status: 'checking' }));
    try {
      const result = await api.validate(JSON.parse(key) as Board);
      if (mine !== seq.current) return null;
      setState({ status: 'ok', result, message: result.message });
      return result;
    } catch (e) {
      if (mine !== seq.current) return null;
      const err = e as ApiClientError;
      setState({
        status: err.unreachable ? 'unavailable' : 'error',
        result: null,
        message: err.unreachable ? 'Validation needs the backend, which is not reachable right now.' : err.message,
      });
      return null;
    }
  }, [api, key]);

  useEffect(() => {
    if (blank) {
      seq.current++;
      setState({ status: 'idle', result: null, message: null });
      return;
    }
    if (backend === 'down') {
      seq.current++;
      setState({ status: 'unavailable', result: null, message: 'Validation needs the backend, which is not reachable right now.' });
      return;
    }
    const t = setTimeout(run, debounceMs);
    return () => clearTimeout(t);
  }, [key, blank, backend, run, debounceMs]);

  return { ...state, validateNow: run };
}
