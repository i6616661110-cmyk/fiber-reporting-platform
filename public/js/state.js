// Shared client state. Mutated in place by the feature modules.
export const state = {
  token: localStorage.getItem('token'),
  username: localStorage.getItem('username'),
  maps: [],          // user's maps: [{id, name, user_map_id, point_count}]
  activeMapId: null,
  mapUnits: [],      // unit definitions of the active map: [{id, name, price}]
  days: [],          // work tree of the active map: days → points → units
  pointNames: [],    // autocomplete cache
  editingDayId: null,
};

export function findDay(id) {
  return state.days.find(d => d.id === id);
}

export function findPoint(pointId) {
  for (const day of state.days) {
    const point = day.points.find(p => p.id === pointId);
    if (point) return { day, point };
  }
  return null;
}

export function findPointUnit(unitId) {
  for (const day of state.days) {
    for (const point of day.points) {
      const unit = point.units.find(u => u.id === unitId);
      if (unit) return { day, point, unit };
    }
  }
  return null;
}

export function activeMap() {
  return state.maps.find(m => m.id === state.activeMapId) || null;
}
