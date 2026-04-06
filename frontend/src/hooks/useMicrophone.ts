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
      if (mics.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(mics[0].deviceId);
      }
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
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
