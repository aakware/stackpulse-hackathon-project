import powerPlantsData from '../assets/power_plants';

export interface PowerPlant {
    name: string;
    latitude: number;
    longitude: number;
    primaryFuel: string;
    owner: string;
    distanceKm: number;
}

interface RawPlantRecord {
    name: string;
    latitude: number;
    longitude: number;
    primary_fuel?: string;
    primaryFuel?: string;
    owner?: string | null;
}

const parsedPlants: Array<{ name: string; latitude: number; longitude: number; primaryFuel: string; owner: string }> = (
    (powerPlantsData as RawPlantRecord[]) || []
)
    .filter((p) => p && p.name && !isNaN(p.latitude) && !isNaN(p.longitude))
    .map((p) => ({
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        primaryFuel: p.primary_fuel || p.primaryFuel || 'Thermal',
        owner: p.owner || 'N/A',
    }));

/**
 * Calculates distance in kilometers between two lat/lon coordinates using Haversine formula.
 */
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Searches for any Indian power plant or heavy energy infrastructure within a spatial radius (default 2.5 km).
 */
export function findNearbyPowerPlant(lat: number, lon: number, radiusKm = 2.5): PowerPlant | null {
    let nearestPlant: PowerPlant | null = null;
    let minDistance = Infinity;

    for (const plant of parsedPlants) {
        // Fast bounding box pre-filter (~0.03° is approx 3 km)
        if (Math.abs(plant.latitude - lat) > 0.03 || Math.abs(plant.longitude - lon) > 0.03) {
            continue;
        }

        const dist = getDistanceKm(lat, lon, plant.latitude, plant.longitude);
        if (dist <= radiusKm && dist < minDistance) {
            minDistance = dist;
            nearestPlant = {
                ...plant,
                distanceKm: Math.round(dist * 100) / 100,
            };
        }
    }

    return nearestPlant;
}
