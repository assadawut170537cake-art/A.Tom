/**
 * @file ตั้งค่าของโหมดคุยด้วยเสียง — เก็บใน ProviderSettings.options (scope `live`)
 */

import { ProviderSettings } from '../../../core/storage/ProviderSettings';

const SCOPE = 'live';

/** พูดแทรก: ค่าเริ่มต้นเปิด */
export async function getBargeIn(): Promise<boolean> {
  return (await ProviderSettings.getOption(SCOPE, 'bargeIn')) !== 'off';
}

export function setBargeIn(on: boolean): Promise<void> {
  return ProviderSettings.setOption(SCOPE, 'bargeIn', on ? 'on' : 'off');
}
