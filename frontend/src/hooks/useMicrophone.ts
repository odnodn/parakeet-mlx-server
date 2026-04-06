import { useState, useCallback, useEffect } from 'react';
import { getMicrophones, requestMicrophonePermission } from '@/services/audioService';

export function useMicrophone() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [hasPermission, setHasPermission] = useState(false);

  const refreshDevices = useCallback(async () => {
    const granted = await requestMicrophonePermission();
    setHasPermission(granted);
    if (granted) {
      const mics = await getMicrophones();
      setDevices(mics);
      setSelectedDeviceId((prev) => (prev || (mics.length > 0 ? mics[0].deviceId : '')));
    }
  }, []);

  useEffect(() => {
    const handler = () => { refreshDevices(); };
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    hasPermission,
    refreshDevices,
  };
}
