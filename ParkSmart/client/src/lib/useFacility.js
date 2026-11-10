import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

const KEY = 'parksmart.facility';

/** Facilities list + the facility chosen on this device (remembered per browser). */
export function useFacility() {
  const [facilities, setFacilities] = useState([]);
  const [facilityId, setFacilityIdState] = useState(() => {
    try { return Number(localStorage.getItem(KEY)) || null; } catch { return null; }
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api('/facilities');
      setFacilities(list);
      setError('');
      setFacilityIdState((cur) => (list.some((f) => f.id === cur) ? cur : (list[0] ? list[0].id : null)));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const setFacilityId = (id) => {
    setFacilityIdState(id);
    try { localStorage.setItem(KEY, String(id)); } catch { /* ignore */ }
  };

  const facility = facilities.find((f) => f.id === facilityId) || null;
  return { facilities, facility, facilityId, setFacilityId, error, loading, reload };
}
