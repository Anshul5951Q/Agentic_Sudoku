import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_BASE_URL = 'sudokumind.baseUrlOverride';

/** Per-device convenience only; the app works (with defaults) if storage is unavailable. */
export async function loadBaseUrlOverride(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_BASE_URL);
  } catch {
    return null;
  }
}

export async function saveBaseUrlOverride(value: string | null): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(KEY_BASE_URL, value);
    else await AsyncStorage.removeItem(KEY_BASE_URL);
  } catch {
    /* ignore: override just won't persist */
  }
}
