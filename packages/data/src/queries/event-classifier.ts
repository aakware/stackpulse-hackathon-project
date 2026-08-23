import { findNearbyPowerPlant, PowerPlant } from './power-plants';

export interface EventProbabilityResult {
    industrialFlare: number;   // 0.0 to 1.0
    cropBurning: number;       // 0.0 to 1.0
    forestFire: number;        // 0.0 to 1.0
    urbanHeat: number;         // 0.0 to 1.0
    unknown: number;           // 0.0 to 1.0
    primaryType: 'Industrial Flare' | 'Agricultural Crop Burning' | 'Forest Fire / Wildfire' | 'Urban / Off-Target Source' | 'Unknown / Low Confidence Signal';
    confidenceLevel: 'High' | 'Moderate' | 'Low';
    nearbyPowerPlant?: PowerPlant | null;
    insights: string[];
}

export interface ClassifyInput {
    latitude: number;
    longitude: number;
    frp?: number | null;
    brightness?: number | null;
    acqDate: string;
    daynight?: string | null;
    persistenceDays180d?: number; // Distinct detection days in last 180 days within 1.5km
    osmLanduse?: string | null;   // OSM land classification string
}

/**
 * Multi-Signal Probabilistic Classifier for Satellite Heat Anomalies.
 * Fuses Spatiotemporal Persistence, Radiometric Signatures (FRP), Diurnal Cycle, OSM Land-Use, and Heavy Infrastructure Proximity.
 */
export function estimateEventProbabilities(input: ClassifyInput): EventProbabilityResult {
    const frp = input.frp ?? 5.0;
    const isNight = input.daynight === 'N';
    const persistenceDays = input.persistenceDays180d ?? 1;
    const osm = (input.osmLanduse || '').toLowerCase();

    // Extract acquisition month (1 - 12)
    const month = input.acqDate ? parseInt(input.acqDate.split('-')[1] || '6', 10) : 6;
    const isHarvestSeason = month === 4 || month === 5 || month === 10 || month === 11;

    // Feature Signals (Log-odds / Unnormalized Logits)
    let sIndustrial = 0.0;
    let sCrop = 0.0;
    let sForest = 0.0;
    let sUrban = 0.0;
    let sUnknown = 1.0; // Baseline entropy / uncertain logit

    const insights: string[] = [];

    // --- Signal 1: Heavy Energy Infrastructure Proximity ---
    const nearbyPlant = findNearbyPowerPlant(input.latitude, input.longitude, 2.5);
    if (nearbyPlant) {
        sIndustrial += 4.5;
        const ownerStr = nearbyPlant.owner && nearbyPlant.owner !== 'N/A' ? `, ${nearbyPlant.owner}` : '';
        insights.push(`Proximity: ${nearbyPlant.distanceKm} km from ${nearbyPlant.name} (${nearbyPlant.primaryFuel} Facility${ownerStr})`);
    }

    // --- Signal 2: Spatiotemporal Persistence ---
    if (persistenceDays >= 5) {
        sIndustrial += 3.8 + (persistenceDays * 0.3);
        insights.push(`Persistence: High (${persistenceDays} active detection days in 180-day window)`);
    } else if (persistenceDays >= 3) {
        sIndustrial += 1.8;
        sCrop += 0.5;
        insights.push(`Persistence: Moderate (${persistenceDays} active detection days)`);
    } else {
        sCrop += 1.2;
        sForest += 1.0;
        insights.push('Persistence: Low / Single-event detection');
    }

    // --- Signal 3: OSM Land Cover Context ---
    if (osm.includes('industrial') || osm.includes('factory') || osm.includes('refinery') || osm.includes('power')) {
        sIndustrial += 3.5;
        sUrban += 0.8;
        insights.push(`OSM Tag: Industrial / Energy zone (${osm})`);
    } else if (osm.includes('farm') || osm.includes('crop') || osm.includes('meadow') || osm.includes('agricultural')) {
        sCrop += 3.0;
        sIndustrial -= 1.0;
        insights.push(`OSM Tag: Agricultural / Cropland zone (${osm})`);
    } else if (osm.includes('forest') || osm.includes('wood') || osm.includes('nature') || osm.includes('scrub')) {
        sForest += 3.2;
        sIndustrial -= 1.5;
        insights.push(`OSM Tag: Forest / Woodland canopy (${osm})`);
    } else if (osm.includes('residential') || osm.includes('commercial') || osm.includes('retail') || osm.includes('landfill')) {
        sUrban += 2.8;
        insights.push(`OSM Tag: Urban / Developed zone (${osm})`);
    }

    // --- Signal 4: Harvest Seasonality ---
    if (isHarvestSeason) {
        sCrop += 1.8;
        if (!osm.includes('industrial') && !nearbyPlant) {
            insights.push(`Seasonality: Crop harvesting window (Month #${month})`);
        }
    }

    // --- Signal 5: Radiometric FRP & Diurnal Cycle ---
    if (frp >= 20.0) {
        sForest += 2.2;
        sIndustrial += 1.2;
        insights.push(`FRP Intensity: High (${frp.toFixed(1)} MW)`);
    } else if (frp <= 4.0 && isNight) {
        sUrban += 2.0;
        insights.push(`Diurnal: Low-intensity nighttime acquisition`);
    }

    // Measure signal ambiguity (if max specific signal is weak, boost sUnknown)
    const maxSpecificSignal = Math.max(sIndustrial, sCrop, sForest, sUrban);
    if (maxSpecificSignal < 2.0) {
        sUnknown += 2.0;
        insights.push('Classification: Signals weak / ambiguous');
    }

    // Softmax Normalization across 5 classes
    const logits = [sIndustrial, sCrop, sForest, sUrban, sUnknown];
    const maxLogit = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);

    const pInd = Math.round((exps[0] / sumExps) * 100) / 100;
    const pCrop = Math.round((exps[1] / sumExps) * 100) / 100;
    const pForest = Math.round((exps[2] / sumExps) * 100) / 100;
    const pUrban = Math.round((exps[3] / sumExps) * 100) / 100;
    const pUnknown = Math.round((exps[4] / sumExps) * 100) / 100;

    const probs = [
        { label: 'Industrial Flare' as const, val: pInd },
        { label: 'Agricultural Crop Burning' as const, val: pCrop },
        { label: 'Forest Fire / Wildfire' as const, val: pForest },
        { label: 'Urban / Off-Target Source' as const, val: pUrban },
        { label: 'Unknown / Low Confidence Signal' as const, val: pUnknown },
    ];

    probs.sort((a, b) => b.val - a.val);

    let confidenceLevel: 'High' | 'Moderate' | 'Low' = 'Low';
    if (probs[0].val >= 0.65) confidenceLevel = 'High';
    else if (probs[0].val >= 0.45) confidenceLevel = 'Moderate';

    return {
        industrialFlare: pInd,
        cropBurning: pCrop,
        forestFire: pForest,
        urbanHeat: pUrban,
        unknown: pUnknown,
        primaryType: probs[0].label,
        confidenceLevel,
        nearbyPowerPlant: nearbyPlant,
        insights,
    };
}
