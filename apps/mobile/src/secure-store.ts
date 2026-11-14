import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN = 'singularity.access-token';
const REFRESH_TOKEN = 'singularity.refresh-token';
const DEVICE_KEY = 'singularity.device-key';
export const PRIVATE_KEY = 'singularity.device-private-key';

export interface MobileSession {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
}

export async function loadSession(): Promise<MobileSession | null> {
  const [accessToken, refreshToken, deviceId] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN),
    SecureStore.getItemAsync(REFRESH_TOKEN),
    SecureStore.getItemAsync(DEVICE_KEY),
  ]);
  if (!accessToken || !refreshToken || !deviceId) return null;
  return { accessToken, refreshToken, deviceId };
}

export async function saveSession(session: MobileSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN, session.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN, session.refreshToken),
    SecureStore.setItemAsync(DEVICE_KEY, session.deviceId),
  ]);
}

export async function clearSession(): Promise<void> {
  await Promise.all([ACCESS_TOKEN, REFRESH_TOKEN, DEVICE_KEY].map((key) => SecureStore.deleteItemAsync(key)));
}
