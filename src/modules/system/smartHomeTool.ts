/**
 * @file Smart Home & Media Tool: ควบคุมอุปกรณ์ Home Assistant / Philips Hue และ Spotify
 */

import { Linking } from 'react-native';

export interface HomeAssistantConfig {
  baseUrl: string;
  token: string;
}

export async function controlHomeAssistant(
  config: HomeAssistantConfig,
  domain: 'light' | 'switch' | 'scene',
  service: 'turn_on' | 'turn_off' | 'toggle',
  entityId: string
): Promise<{ success: boolean; message: string }> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/api/services/${domain}/${service}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ entity_id: entityId }),
  });

  if (!res.ok) {
    throw new Error(`Home Assistant error: ${res.statusText} (${res.status})`);
  }

  return { success: true, message: `สั่ง ${service} อุปกรณ์ ${entityId} เรียบร้อย` };
}

export async function openSpotifySearch(query: string): Promise<boolean> {
  const encoded = encodeURIComponent(query);
  const appUri = `spotify:search:${encoded}`;
  const webUrl = `https://open.spotify.com/search/${encoded}`;

  const canOpen = await Linking.canOpenURL(appUri);
  if (canOpen) {
    await Linking.openURL(appUri);
    return true;
  }
  await Linking.openURL(webUrl);
  return true;
}
