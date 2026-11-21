import { Share } from 'react-native';

/** Export JSON through the Android share sheet (save to Files, Drive, email…). No extra native dependency. */
export async function shareJson(title: string, data: unknown): Promise<boolean> {
  const message = JSON.stringify(data, null, 2);
  const r = await Share.share({ title, message });
  return r.action !== Share.dismissedAction;
}
