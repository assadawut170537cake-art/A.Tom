import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { hasConfiguredLLM } from '../../ai/core/keyStatus';

export type AIKeyStatus = 'checking' | 'ready' | 'missing';

/**
 * ตรวจว่ามี LLM ที่ใส่ key แล้วหรือยัง — ตรวจใหม่ทุกครั้งที่หน้ากลับมา focus
 * (เช่น บอสไปใส่ key ในหน้าตั้งค่าแล้วกดย้อนกลับ)
 */
export function useAIKeyStatus(check: () => Promise<boolean> = hasConfiguredLLM): AIKeyStatus {
  const [status, setStatus] = useState<AIKeyStatus>('checking');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      check()
        .then((ok) => {
          if (active) setStatus(ok ? 'ready' : 'missing');
        })
        .catch((e: unknown) => {
          // ตรวจไม่ได้ (เช่น SecureStore มีปัญหา) → ไม่เตือนผิด ๆ; ถ้าไม่มี key จริง แชทจะแจ้งเองตอนส่ง
          console.error('[chat] ตรวจสถานะ API key ไม่ได้', e);
          if (active) setStatus('ready');
        });
      return () => {
        active = false;
      };
    }, [check]),
  );

  return status;
}
